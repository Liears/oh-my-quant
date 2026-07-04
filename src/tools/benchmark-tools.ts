import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { smaSignals, vectorizedBacktest } from "../quant/backtest.ts";
import { evaluate } from "../quant/benchmark.ts";
import { collectResults, dashboardSummary } from "../quant/dashboard.ts";
import { fetchBars } from "../runtime/source-runtime.ts";
import { listBenchmarkResults, saveBenchmarkResult } from "../storage/index.ts";
import { inferMarket } from "../market/symbols.ts";
import { err, ok } from "./shared/results.ts";
import { loadCachedBars } from "./shared/cached-bars.ts";

const S = {
  ScoreBenchmark: Type.Object({
    symbol: Type.String(),
    benchmark_symbol: Type.String({ default: "000300.SH" }),
    fast: Type.Number({ default: 20 }),
    slow: Type.Number({ default: 60 }),
    cash: Type.Number({ default: 100_000 }),
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
  async execute(_id: string, args: ScoreBenchmarkArgs): Promise<AgentToolResult<unknown>> {
    const fetchPrices = async (symbol: string) => {
      const cached = await loadCachedBars(symbol);
      if (cached) return cached.bars;
      const market = inferMarket(symbol);
      const result = await fetchBars(symbol, market, undefined, undefined, market === "A" ? "akshare" : undefined);
      return result.bars;
    };

    const [stratBars, benchBars] = await Promise.all([
      fetchPrices(args.symbol),
      fetchPrices(args.benchmark_symbol),
    ]);
    if (stratBars.length === 0) return err("DATA_REQUEST_FAILED", `No local data for ${args.symbol}`);
    if (benchBars.length === 0) return err("DATA_REQUEST_FAILED", `No local data for ${args.benchmark_symbol}`);

    const benchDates = new Set(benchBars.map((b) => b.date));
    const alignedStrat = stratBars.filter((b) => benchDates.has(b.date));
    const alignedBench = benchBars.filter((b) => benchDates.has(b.date));
    const stratClose = alignedStrat.map((b) => b.close);
    const benchClose = alignedBench.map((b) => b.close);

    const split = Math.floor(stratClose.length * 0.7);
    const signals = smaSignals(stratClose, args.fast, args.slow);
    const { returns: stratReturns } = vectorizedBacktest(signals, stratClose, args.cash);
    const benchReturns = benchClose.slice(1).map((v, i) => v / benchClose[i] - 1);

    const trainSig = smaSignals(stratClose.slice(0, split), args.fast, args.slow);
    const testSig = smaSignals(stratClose.slice(split), args.fast, args.slow);
    const { returns: trainR } = vectorizedBacktest(trainSig, stratClose.slice(0, split), args.cash);
    const { returns: testR } = vectorizedBacktest(testSig, stratClose.slice(split), args.cash);

    const score = evaluate(
      { returns: stratReturns.slice(1) },
      { returns: benchReturns },
      { returns: trainR.slice(1) },
      { returns: testR.slice(1) },
    );

    const now = new Date().toISOString().slice(0, 10);
    const name = args.label || `sma_${args.fast}_${args.slow}`;
    const filename = `${name}_${now}.json`;
    saveBenchmarkResult(filename, {
      strategy: name,
      date: now,
      symbol: args.symbol,
      benchmark_symbol: args.benchmark_symbol,
      window: { fast: args.fast, slow: args.slow },
      source: {
        strategy: { market: inferMarket(args.symbol), fetcher: "local" },
        benchmark: { market: inferMarket(args.benchmark_symbol), fetcher: "local" },
      },
      ...score,
    });

    return ok([
      `Benchmark  ${name}`,
      `Grade         ${score.grade}`,
      `Score         ${score.totalScore}/100`,
      `Return/Risk   ${score.returnScore}/40  \u00b7  ${score.riskScore}/40`,
      `Robustness    ${score.robustnessScore}/20`,
      `CAGR          ${(score.details.cagr * 100).toFixed(2)}%`,
      `Sharpe        ${score.details.sharpe}`,
      `Max DD        ${(score.details.maxDrawdown * 100).toFixed(2)}%`,
      `Saved         .ohquant/benchmark/results/${filename}`,
    ].join("\n"), { filename, ...score });
  },
};

export const showDashboardTool: AgentTool<typeof S.ShowDashboard> = {
  name: "show_dashboard",
  description: "Show benchmark results dashboard from .ohquant/benchmark/results/",
  label: "Dashboard",
  parameters: S.ShowDashboard,
  executionMode: "sequential",
  async execute(_id: string, _args: ShowDashboardArgs): Promise<AgentToolResult<unknown>> {
    const results = listBenchmarkResults();
    if (results.length === 0) return ok("No benchmark results yet. Try: 'Run SMA 20/60 backtest on 000001.SZ'");
    const rows = collectResults(results);
    const s = dashboardSummary(rows);
    const sorted = [...rows].sort((a, b) => b.totalScore - a.totalScore).slice(0, 10);

    return ok([
      `Dashboard  ${s.totalEvals} evaluations`,
      `Avg ${s.avgScore}  Median ${s.medianScore}  Best ${s.bestStrategy} (${s.bestScore})`,
      `Grades  ${Object.entries(s.gradeDistribution).map(([g, n]) => `${g}:${n}`).join("  ")}`,
      "",
      ...sorted.map((r) => `  ${r.grade.padEnd(2)} ${r.strategy.padEnd(28)} score=${String(r.totalScore).padEnd(5)} sharpe=${r.sharpe} dd=${(r.maxDrawdown * 100).toFixed(1)}%`),
    ].join("\n"), { summary: s });
  },
};

export const QUANT_BENCHMARK_TOOLS: AgentTool[] = [
  scoreBenchmarkTool,
  showDashboardTool,
];
