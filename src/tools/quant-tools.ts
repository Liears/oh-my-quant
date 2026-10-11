/**
 * Quant computation tool definitions — pi AgentTool format.
 * Data is fetched or refreshed automatically before pure computations run.
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { smaSignals, vectorizedBacktest, validateBacktestCosts } from "../quant/backtest.ts";
import { calendarYears, report } from "../quant/performance.ts";
import { computeFactor, summarizeFactor } from "../quant/factor.ts";
import { metrics, RISK_EVIDENCE_BOUNDARY } from "../quant/risk.ts";
import { QUANT_BENCHMARK_TOOLS } from "./benchmark-tools.ts";
import { QUANT_FUND_DCA_TOOLS } from "./fund-dca-tools.ts";
import { err, ok } from "./shared/results.ts";
import { loadAnalysisBars, validateBacktestParameters } from "../runtime/analysis-data.ts";
import { dataTimeEvidence } from "./shared/data-time-evidence.ts";
import { preparePriceAnalysisBars } from "./shared/analysis-observation.ts";
import { factorEvidenceBoundary } from "../quant/factor-evidence.ts";

export { scoreBenchmarkTool, showDashboardTool } from "./benchmark-tools.ts";
export { fundDcaBacktestTool } from "./fund-dca-tools.ts";

const Historical = {
  market: Type.Optional(Type.Union([Type.Literal("A"), Type.Literal("US"), Type.Literal("HK")],
    { description: "Optional symbol-market identity check for current analysis; required with observed_before." })),
  source: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("akshare"), Type.Literal("tushare"),
    Type.Literal("llmquant-data"), Type.Literal("financial-datasets")],
    { description: "Optional archive source with observed_before; otherwise /config source is used." })),
  observed_before: Type.Optional(Type.String({ description: "Exact UTC app-observation cutoff YYYY-MM-DDTHH:mm:ss.sssZ. Requires market/start/end; archive only, no current provider or cache head. Does not prove provider publication or complete trading days." })),
};

const S = {
  ComputeFactor: Type.Object({
    symbol: Type.String(),
    factor: Type.Union([Type.Literal("momentum"), Type.Literal("reversal"), Type.Literal("volatility"),
      Type.Literal("volume_ratio"), Type.Literal("rsi"), Type.Literal("sma_deviation")]),
    period: Type.Optional(Type.Integer({ default: 20, minimum: 1 })),
    start: Type.Optional(Type.String()), end: Type.Optional(Type.String()), ...Historical,
  }),
  RunBacktest: Type.Object({
    symbol: Type.String(),
    fast: Type.Optional(Type.Integer({ default: 20, minimum: 1 })), slow: Type.Optional(Type.Integer({ default: 60, minimum: 2 })),
    cash: Type.Optional(Type.Number({ default: 100_000, exclusiveMinimum: 0 })),
    commission: Type.Optional(Type.Number({ default: 0.0003, minimum: 0, exclusiveMaximum: 1 })),
    stamp_duty: Type.Optional(Type.Number({ default: 0, minimum: 0, exclusiveMaximum: 1 })),
    start: Type.Optional(Type.String()), end: Type.Optional(Type.String()), ...Historical,
  }),
  CheckRisk: Type.Object({
    symbol: Type.String(),
    start: Type.Optional(Type.String()), end: Type.Optional(Type.String()), ...Historical,
  }),
};

type ComputeFactorArgs = Static<typeof S.ComputeFactor>;
type RunBacktestArgs = Static<typeof S.RunBacktest>;
type CheckRiskArgs = Static<typeof S.CheckRisk>;

// ── compute_factor ──

/** Bind price preparation per host; default exports retain automatic local data preparation. */
export function createPriceAnalysisTools(loadBars: typeof loadAnalysisBars = loadAnalysisBars,
  loadArchiveBars: typeof loadAnalysisBars | null = loadBars === loadAnalysisBars ? loadAnalysisBars : null) {
  const computeFactorTool: AgentTool<typeof S.ComputeFactor> = {
    name: "compute_factor",
    description: "Compute historical factor values over optional start/end dates; current requests refresh automatically. Latest, prior mean and percentile do not test future returns or mean reversion. With observed_before, market/start/end are required and only one immutable app-observed response is used. Price dates do not prove provider publication or complete trading days.",
    label: "Factor",
    parameters: S.ComputeFactor,
    executionMode: "sequential",
    async execute(_id: string, args: ComputeFactorArgs, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
      const period = args.period ?? 20;
      if (!Number.isInteger(period) || period < 1) throw new Error("Factor period must be a positive integer.");
      const prepared = await preparePriceAnalysisBars(loadBars, loadArchiveBars, args, period + 1, signal);
      if ("error" in prepared) return prepared.error;
      const { cached, archiveRequest } = prepared;
      signal?.throwIfAborted();
      if (cached.bars.length < period + 1) return err("DATA_NOT_ENOUGH", `Need ${period + 1}+ bars, got ${cached.bars.length}. ${archiveRequest ? "The selected archive has insufficient rows." : "Data was requested automatically."}`);

      const close = cached.bars.map((b) => b.close);
      const volume = cached.bars.map((b) => b.volume);
      const values = computeFactor(args.factor, close, volume, period);
      const { last, mean, percentile: pctRank } = summarizeFactor(values);
      const time = dataTimeEvidence(cached);
      const evidenceBoundary = factorEvidenceBoundary(args.factor);

      return ok([
        ...(archiveRequest ? [`Archive cutoff ${archiveRequest.observedBefore} · app-observed response only; provider publication and trading-day completeness unverified`] : []),
        `Factor  ${args.symbol}  ${args.factor}_${period}`,
        `Source      ${cached.source}`,
        `Data        ${cached.origin} · price date ${time.latestBarDate}`,
        `Observed    ${time.observationAt ?? "unverified"} · ${time.historicalAvailability}`,
        time.priceAdjustmentNote,
        `Latest      ${last?.toFixed(4) ?? "N/A"}`,
        `Mean        ${mean === null ? "N/A (no prior factor values)" : mean.toFixed(4)}`,
        `Percentile  ${pctRank === null ? "N/A (no prior factor values)" : `${(pctRank * 100).toFixed(0)}%`}`,
        `Inference   ${evidenceBoundary}`,
      ].join("\n"),
      { symbol: args.symbol, source: cached.source, origin: cached.origin, dataset: cached.dataset, asOfDate: cached.asOfDate, ...time,
        ...(archiveRequest ? { archiveRequest, historicalBoundary: cached.historicalBoundary } : {}),
        factor: args.factor, period: period, last, mean, percentile: pctRank, evidenceBoundary });
    },
  };

  // ── run_backtest ──

  const runBacktestTool: AgentTool<typeof S.RunBacktest> = {
    name: "run_backtest",
    description: "Run an SMA crossover backtest; current requests refresh automatically. With observed_before, market/start/end are required and the calculation reads one immutable app archive without a provider call. Historical provider publication and complete trading days remain unverified.",
    label: "Backtest",
    parameters: S.RunBacktest,
    executionMode: "sequential",
    async execute(_id: string, args: RunBacktestArgs, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
      const fast = args.fast ?? 20, slow = args.slow ?? 60, cash = args.cash ?? 100_000;
      const commission = args.commission ?? 0.0003, stampDuty = args.stamp_duty ?? 0;
      validateBacktestParameters(fast, slow, cash);
      validateBacktestCosts(commission, stampDuty);
      const prepared = await preparePriceAnalysisBars(loadBars, loadArchiveBars, args, slow + 10, signal);
      if ("error" in prepared) return prepared.error;
      const { cached, archiveRequest } = prepared;
      signal?.throwIfAborted();
      if (cached.bars.length < slow + 10)
        return err("DATA_NOT_ENOUGH", `Need ${slow + 10}+ bars for SMA(${fast},${slow}), got ${cached.bars.length}.`);

      const close = cached.bars.map((b) => b.close);
      const signals = smaSignals(close, fast, slow);
      const dates = cached.bars.map(bar => bar.date);
      const ledger = vectorizedBacktest(signals, close, cash, commission, stampDuty);
      const elapsedYears = calendarYears(dates);
      const r = report(ledger.returns.slice(1), undefined, { elapsedYears });
      const time = dataTimeEvidence(cached);

      return ok([
        ...(archiveRequest ? [`Archive cutoff ${archiveRequest.observedBefore} · app-observed response only; provider publication and trading-day completeness unverified`] : []),
        `Backtest  ${args.symbol}  SMA(${fast},${slow})`,
        `Source        ${cached.source}`,
        `Data          ${cached.origin} · price date ${time.latestBarDate}`,
        `Observed      ${time.observationAt ?? "unverified"} · ${time.historicalAvailability}`,
        time.priceAdjustmentNote,
        `Total return  ${(r.totalReturn * 100).toFixed(2)}%`,
        `CAGR          ${(r.cagr * 100).toFixed(2)}%`,
        `Sharpe        ${r.sharpe?.toFixed(2) ?? "N/A"}`,
        `Max DD        ${(r.maxDrawdown * 100).toFixed(2)}%`,
        `Up periods    ${(r.winRate * 100).toFixed(1)}% of nonzero return periods`,
        `Period P/L    ${r.pnlRatio?.toFixed(2) ?? "N/A"}`,
        `Costs         commission ${commission} · sell duty ${stampDuty} (simulation assumptions)`,
        "Execution     prior signal at next close · fractional shares · no slippage",
        "Annualization calendar CAGR · 252-period volatility/ratios",
      ].join("\n"), { symbol: args.symbol, source: cached.source, origin: cached.origin, dataset: cached.dataset, ...time,
        ...(archiveRequest ? { archiveRequest, historicalBoundary: cached.historicalBoundary } : {}),
        start: dates[0], end: dates.at(-1), dates, ledger,
        assumptions: { commission, stampDuty, elapsedYears, periodsPerYear: 252, execution: "next-close", fractionalShares: true, slippage: 0 }, ...r });
    },
  };

  // ── check_risk ──

  const checkRiskTool: AgentTool<typeof S.CheckRisk> = {
    name: "check_risk",
    description: "Compute risk metrics; current requests refresh automatically. With observed_before, market/start/end are required and only one immutable app-observed response is used, without contacting a current provider.",
    label: "Risk",
    parameters: S.CheckRisk,
    executionMode: "sequential",
    async execute(_id: string, args: CheckRiskArgs, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
      const prepared = await preparePriceAnalysisBars(loadBars, loadArchiveBars, args, 30, signal);
      if ("error" in prepared) return prepared.error;
      const { cached, archiveRequest } = prepared;
      signal?.throwIfAborted();
      if (cached.bars.length < 30) return err("DATA_NOT_ENOUGH", `Risk analysis needs 30+ bars, got ${cached.bars.length}.`);

      const close = cached.bars.map((b) => b.close);
      const returns = close.slice(1).map((v, i) => v / close[i] - 1);
      const m = metrics(returns);
      const time = dataTimeEvidence(cached);

      return ok([
        ...(archiveRequest ? [`Archive cutoff ${archiveRequest.observedBefore} · app-observed response only; provider publication and trading-day completeness unverified`] : []),
        `Risk  ${args.symbol}`,
        `Source        ${cached.source}`,
        `Data          ${cached.origin} · price date ${time.latestBarDate}`,
        `Observed      ${time.observationAt ?? "unverified"} · ${time.historicalAvailability}`,
        time.priceAdjustmentNote,
        `Sample        ${close.length} closing observations · ${returns.length} return intervals`,
        `CVaR 95 tail  ${returns.filter(value => value <= m.var95).length}/${returns.length} return intervals at or below historical VaR 95 (including ties)`,
        `Annual vol    ${(m.annualVol * 100).toFixed(2)}%`,
        `Downside vol  ${(m.downsideVol * 100).toFixed(2)}%`,
        `VaR 95        ${(m.var95 * 100).toFixed(2)}% hist  /  ${(m.var95Parametric * 100).toFixed(2)}% norm`,
        `VaR 99        ${(m.var99 * 100).toFixed(2)}%`,
        `CVaR 95       ${(m.cvar95 * 100).toFixed(2)}%`,
        `Max DD        ${(m.maxDrawdown * 100).toFixed(2)}%`,
        `Longest underwater  ${m.maxDdDays} observed periods (separate from maximum drawdown depth)`,
        `Skew/Kurt     ${m.skewness.toFixed(3)} / ${m.kurtosis.toFixed(3)}`,
        RISK_EVIDENCE_BOUNDARY,
      ].join("\n"), { symbol: args.symbol, source: cached.source, origin: cached.origin, dataset: cached.dataset, ...time,
        ...(archiveRequest ? { archiveRequest, historicalBoundary: cached.historicalBoundary } : {}),
        start: cached.bars[0]!.date, end: cached.asOfDate, ...m });
    },
  };

  return { computeFactorTool, runBacktestTool, checkRiskTool };
}

export const { computeFactorTool, runBacktestTool, checkRiskTool } = createPriceAnalysisTools();

/** Computation tools with automatic data preparation. */
export const COMPUTE_TOOLS: AgentTool[] = [
  computeFactorTool,
  runBacktestTool,
  checkRiskTool,
  ...QUANT_FUND_DCA_TOOLS,
  ...QUANT_BENCHMARK_TOOLS,
];
