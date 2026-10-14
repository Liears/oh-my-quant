import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  smaSignals, vectorizedBacktest, validateBacktestCosts, BENCHMARK_PRICE_BASIS,
  BENCHMARK_PRICE_BASIS_ID, DEFAULT_BENCHMARK_SYMBOL, evaluate, collectResults,
  dashboardSummary, rankResults,
} from "../quant/index.ts";
import { loadAnalysisBars, validateBacktestParameters } from "../runtime/data/analysis-data.ts";
import { listBenchmarkResultSnapshots, saveBenchmarkResult } from "../storage/index.ts";
import { inferMarket } from "../market/symbols.ts";
import { err, ok } from "./shared/results.ts";
import { formatPercent } from "./shared/format-percent.ts";
import { dataTimeEvidence } from "./shared/data-time-evidence.ts";

const S = {
  ScoreBenchmark: Type.Object({
    symbol: Type.String(),
    benchmark_symbol: Type.Optional(Type.String({ default: DEFAULT_BENCHMARK_SYMBOL })),
    fast: Type.Optional(Type.Integer({ minimum: 1, default: 20 })),
    slow: Type.Optional(Type.Integer({ minimum: 2, default: 60 })),
    cash: Type.Optional(Type.Number({ exclusiveMinimum: 0, default: 100_000 })),
    commission: Type.Optional(Type.Number({ default: 0.0003, minimum: 0, exclusiveMaximum: 1 })),
    stamp_duty: Type.Optional(Type.Number({ default: 0, minimum: 0, exclusiveMaximum: 1 })),
    label: Type.Optional(Type.String()),
  }),
  ShowDashboard: Type.Object({
    sort_by: Type.Optional(Type.Union([Type.Literal("score"), Type.Literal("cagr"), Type.Literal("sharpe")])),
  }),
};

type ScoreBenchmarkArgs = Static<typeof S.ScoreBenchmark>;
type ShowDashboardArgs = Static<typeof S.ShowDashboard>;

export const scoreBenchmarkTool: AgentTool<typeof S.ScoreBenchmark> = {
  name: "score_benchmark",
  description: "Run 3-dimension strategy evaluation (Return 40 + Risk 40 + Robustness 20 = 100). Fetches local bars, runs backtest, scores, saves to .ohquant/.",
  label: "Score",
  parameters: S.ScoreBenchmark,
  executionMode: "sequential",
  async execute(_id: string, args: ScoreBenchmarkArgs, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
    const { fast = 20, slow = 60, cash = 100_000, benchmark_symbol = DEFAULT_BENCHMARK_SYMBOL } = args;
    const commission = args.commission ?? 0.0003, stampDuty = args.stamp_duty ?? 0;
    validateBacktestParameters(fast, slow, cash);
    validateBacktestCosts(commission, stampDuty);
    const minimum = Math.ceil((slow + 10) / 0.3);
    const [strategyData, benchmarkData] = await Promise.all([
      loadAnalysisBars(args.symbol, minimum, undefined, undefined, signal),
      loadAnalysisBars(benchmark_symbol, minimum, undefined, undefined, signal),
    ]);
    signal?.throwIfAborted();
    const stratBars = strategyData.bars, benchBars = benchmarkData.bars;
    if (stratBars.length === 0) return err("DATA_REQUEST_FAILED", `No data for ${args.symbol}`);
    if (benchBars.length === 0) return err("DATA_REQUEST_FAILED", `No data for ${benchmark_symbol}`);

    const benchDates = new Set(benchBars.map((b) => b.date));
    const alignedStrat = stratBars.filter((b) => benchDates.has(b.date));
    const commonDates = new Set(alignedStrat.map(bar => bar.date));
    const alignedBench = benchBars.filter(bar => commonDates.has(bar.date));
    if (alignedStrat.length < minimum) return err("DATA_NOT_ENOUGH", `Need ${minimum}+ common trading dates for training and test windows, got ${alignedStrat.length}.`);
    const stratClose = alignedStrat.map((b) => b.close);
    const benchClose = alignedBench.map((b) => b.close);
    const dates = alignedStrat.map(bar => bar.date);

    const split = Math.floor(stratClose.length * 0.7);
    const signals = smaSignals(stratClose, fast, slow);
    const { returns: stratReturns } = vectorizedBacktest(signals, stratClose, cash, commission, stampDuty);
    const benchReturns = benchClose.slice(1).map((v, i) => v / benchClose[i] - 1);

    const trainSig = smaSignals(stratClose.slice(0, split), fast, slow);
    const testSig = smaSignals(stratClose.slice(split), fast, slow);
    const { returns: trainR } = vectorizedBacktest(trainSig, stratClose.slice(0, split), cash, commission, stampDuty);
    const { returns: testR } = vectorizedBacktest(testSig, stratClose.slice(split), cash, commission, stampDuty);

    const score = evaluate(
      { returns: stratReturns.slice(1), dates },
      { returns: benchReturns, dates: alignedBench.map(bar => bar.date) },
      { returns: trainR.slice(1), dates: dates.slice(0, split) },
      { returns: testR.slice(1), dates: dates.slice(split) },
    );

    const now = new Date().toISOString().slice(0, 10);
    const name = args.label || `sma_${fast}_${slow}`;
    const safeName = name.replace(/[^\p{L}\p{N}_.-]+/gu, "_").slice(0, 60) || "benchmark";
    const filename = `${safeName}_${now}_${randomUUID()}.json`;
    const datasets = { strategy: strategyData.dataset, benchmark: benchmarkData.dataset };
    signal?.throwIfAborted();
    saveBenchmarkResult(filename, {
      methodVersion: 3,
      parameters: { fast, slow, cash, commission, stampDuty },
      strategy: name,
      date: now,
      symbol: args.symbol,
      benchmark_symbol: benchmark_symbol,
      window: { fast: fast, slow: slow },
      dates,
      datasets,
      assumptions: { commission, stampDuty, cagr: "calendar/365.25", periodsPerYear: 252, execution: "next-close", benchmark: "gross-buy-and-hold", priceBasis: BENCHMARK_PRICE_BASIS_ID, split: "independent-restart", monthScore: "observed-calendar-months-including-partials" },
      source: {
        strategy: { market: inferMarket(args.symbol), fetcher: strategyData.source, origin: strategyData.origin },
        benchmark: { market: inferMarket(benchmark_symbol), fetcher: benchmarkData.source, origin: benchmarkData.origin },
      },
      ...score,
    });

    return ok([
      `Benchmark  ${name}`,
      `Grade         ${score.grade}`,
      `Score         ${score.totalScore}/100`,
      `Return/Risk   ${score.returnScore}/40  \u00b7  ${score.riskScore}/40`,
      `Robustness    ${score.robustnessScore}/20`,
      `CAGR          ${formatPercent(score.details.cagr, 2)}`,
      `Sharpe        ${score.details.sharpe ?? "N/A"}`,
      `Max DD        ${formatPercent(score.details.maxDrawdown, 2)}`,
      `Costs         commission ${commission} · sell duty ${stampDuty} (simulation assumptions)`,
      "Basis         calendar CAGR · 252-period ratios · gross buy-and-hold benchmark",
      `Price basis   ${BENCHMARK_PRICE_BASIS}`,
      `Strategy      ${dataTimeEvidence(strategyData).priceAdjustmentNote}`,
      `Benchmark     ${dataTimeEvidence(benchmarkData).priceAdjustmentNote}`,
      `Saved         .ohquant/benchmark/results/${filename}`,
    ].join("\n"), { filename, dates, datasets, ...score });
  },
};

export const showDashboardTool: AgentTool<typeof S.ShowDashboard> = {
  name: "show_dashboard",
  description: "Rank saved benchmark evaluations, preserving this scan's results, parameters and data references for report recovery. No fresh market request.",
  label: "Dashboard",
  parameters: S.ShowDashboard,
  executionMode: "sequential",
  async execute(_id: string, args: ShowDashboardArgs, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const sortBy = args.sort_by ?? "score";
    if (!["score", "cagr", "sharpe"].includes(sortBy)) throw new Error("Invalid dashboard sort metric");
    const { snapshots, unavailableFiles } = await listBenchmarkResultSnapshots(signal);
    const results = snapshots.map(snapshot => snapshot.result);
    const rows = collectResults(results);
    const s = dashboardSummary(rows);
    const sorted = rankResults(rows, sortBy);
    const invalidResults = results.length - rows.length;
    const details = { methodVersion: 1, sortBy, snapshots, unavailableFiles, invalidResults, rows: sorted, summary: s };
    signal?.throwIfAborted();
    if (rows.length === 0) return ok(unavailableFiles || invalidResults
      ? `No valid benchmark results. Unreadable files: ${unavailableFiles}; invalid records: ${invalidResults}. Originals preserved.`
      : "No benchmark results yet. Try: 'Run SMA 20/60 backtest on 000001.SZ'", details);

    return ok([
      `Dashboard  ${s.totalEvals} evaluations`,
      `Avg ${s.avgScore}  Median ${s.medianScore}  Best ${s.bestStrategy} (${s.bestScore})`,
      `Grades  ${Object.entries(s.gradeDistribution).map(([g, n]) => `${g}:${n}`).join("  ")}`,
      `Scope   ${rows.length} readable evaluations · sort ${sortBy} · top ${sorted.length}; unreadable ${unavailableFiles}, invalid ${invalidResults}`,
      "Basis   Saved observations; date windows and sources may differ. Provider closes are not FX-converted. Missing metrics are N/A.",
      "",
      ...sorted.map((r) => `  ${r.grade.padEnd(2)} ${r.strategy.padEnd(28)} score=${String(r.totalScore).padEnd(5)} sharpe=${r.sharpe ?? "N/A"} dd=${r.maxDrawdown === null ? "N/A" : formatPercent(r.maxDrawdown, 1)}`),
    ].join("\n"), details);
  },
};

export const QUANT_BENCHMARK_TOOLS: AgentTool[] = [
  scoreBenchmarkTool,
  showDashboardTool,
];
