/**
 * Quant computation tool definitions — pi AgentTool format.
 * These depend on local data tools having cached the price data first.
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { smaSignals, vectorizedBacktest, report } from "../quant/backtest.ts";
import { computeFactor } from "../quant/factor.ts";
import { metrics } from "../quant/risk.ts";
import { QUANT_BENCHMARK_TOOLS } from "./benchmark-tools.ts";
import { QUANT_FUND_DCA_TOOLS } from "./fund-dca-tools.ts";
import { err, ok } from "./shared/results.ts";
import { loadCachedBars } from "./shared/cached-bars.ts";

export { scoreBenchmarkTool, showDashboardTool } from "./benchmark-tools.ts";
export { fundDcaBacktestTool } from "./fund-dca-tools.ts";

const S = {
  ComputeFactor: Type.Object({
    symbol: Type.String(),
    factor: Type.Union([Type.Literal("momentum"), Type.Literal("reversal"), Type.Literal("volatility"),
      Type.Literal("volume_ratio"), Type.Literal("rsi"), Type.Literal("sma_deviation")]),
    period: Type.Number({ default: 20 }),
  }),
  RunBacktest: Type.Object({
    symbol: Type.String(),
    fast: Type.Number({ default: 20 }), slow: Type.Number({ default: 60 }),
    cash: Type.Number({ default: 100_000 }),
    start: Type.Optional(Type.String()), end: Type.Optional(Type.String()),
  }),
  CheckRisk: Type.Object({
    symbol: Type.String(),
    start: Type.Optional(Type.String()), end: Type.Optional(Type.String()),
  }),
};

type ComputeFactorArgs = Static<typeof S.ComputeFactor>;
type RunBacktestArgs = Static<typeof S.RunBacktest>;
type CheckRiskArgs = Static<typeof S.CheckRisk>;

// ── compute_factor ──

export const computeFactorTool: AgentTool<typeof S.ComputeFactor> = {
  name: "compute_factor",
  description: "Compute technical factor (momentum, reversal, volatility, volume_ratio, rsi, sma_deviation). Requires cached price data.",
  label: "Factor",
  parameters: S.ComputeFactor,
  executionMode: "sequential",
  async execute(_id: string, args: ComputeFactorArgs): Promise<AgentToolResult<unknown>> {
    const cached = await loadCachedBars(args.symbol);
    if (!cached) return err("DATA_NO_CACHE", `${args.symbol}. Call fetch_bars first.`);

    const close = cached.bars.map((b) => b.close);
    const volume = cached.bars.map((b) => b.volume);
    const values = computeFactor(args.factor, close, volume, args.period);
    const allValid = values.filter((v): v is number => v !== null);
    const last = allValid.pop();
    const mean = allValid.length > 0 ? allValid.reduce((a: number, b: number) => a + b, 0) / allValid.length : 0;
    const sorted = [...allValid].sort((a, b) => a - b);
    const pctRank = last !== undefined && sorted.length > 0
      ? sorted.filter((v) => v <= last).length / sorted.length : 0;

    return ok([
      `Factor  ${args.symbol}  ${args.factor}_${args.period}`,
      `Source      ${cached.source}`,
      `Latest      ${last?.toFixed(4) ?? "N/A"}`,
      `Mean        ${mean.toFixed(4)}`,
      `Percentile  ${(pctRank * 100).toFixed(0)}%`,
    ].join("\n"),
    { symbol: args.symbol, factor: args.factor, period: args.period, last, mean, percentile: pctRank });
  },
};

// ── run_backtest ──

export const runBacktestTool: AgentTool<typeof S.RunBacktest> = {
  name: "run_backtest",
  description: "Run SMA crossover backtest. Requires cached price data.",
  label: "Backtest",
  parameters: S.RunBacktest,
  executionMode: "sequential",
  async execute(_id: string, args: RunBacktestArgs): Promise<AgentToolResult<unknown>> {
    const cached = await loadCachedBars(args.symbol);
    if (!cached) return err("DATA_NO_CACHE", `${args.symbol}. Call fetch_bars first.`);
    if (cached.bars.length < args.slow + 10)
      return err("DATA_NOT_ENOUGH", `Need ${args.slow + 10}+ bars for SMA(${args.fast},${args.slow}), got ${cached.bars.length}.`);

    const close = cached.bars.map((b) => b.close);
    const signals = smaSignals(close, args.fast, args.slow);
    const { returns } = vectorizedBacktest(signals, close, args.cash);
    const r = report(returns);

    return ok([
      `Backtest  ${args.symbol}  SMA(${args.fast},${args.slow})`,
      `Source        ${cached.source}`,
      `Total return  ${(r.totalReturn * 100).toFixed(2)}%`,
      `CAGR          ${(r.cagr * 100).toFixed(2)}%`,
      `Sharpe        ${r.sharpe.toFixed(2)}`,
      `Max DD        ${(r.maxDrawdown * 100).toFixed(2)}%`,
      `Win rate      ${(r.winRate * 100).toFixed(1)}%`,
      `P/L ratio     ${r.pnlRatio.toFixed(2)}`,
    ].join("\n"), { symbol: args.symbol, ...r });
  },
};

// ── check_risk ──

export const checkRiskTool: AgentTool<typeof S.CheckRisk> = {
  name: "check_risk",
  description: "Compute risk metrics: annual vol, VaR(95/99), CVaR(95/99), max drawdown. Requires cached price data.",
  label: "Risk",
  parameters: S.CheckRisk,
  executionMode: "sequential",
  async execute(_id: string, args: CheckRiskArgs): Promise<AgentToolResult<unknown>> {
    const cached = await loadCachedBars(args.symbol);
    if (!cached) return err("DATA_NO_CACHE", `${args.symbol}. Call fetch_bars first.`);

    const close = cached.bars.map((b) => b.close);
    const returns = close.slice(1).map((v, i) => v / close[i] - 1);
    const m = metrics(returns);

    return ok([
      `Risk  ${args.symbol}`,
      `Source        ${cached.source}`,
      `Annual vol    ${(m.annualVol * 100).toFixed(2)}%`,
      `Downside vol  ${(m.downsideVol * 100).toFixed(2)}%`,
      `VaR 95        ${(m.var95 * 100).toFixed(2)}% hist  /  ${(m.var95Parametric * 100).toFixed(2)}% norm`,
      `VaR 99        ${(m.var99 * 100).toFixed(2)}%`,
      `CVaR 95       ${(m.cvar95 * 100).toFixed(2)}%`,
      `Max DD        ${(m.maxDrawdown * 100).toFixed(2)}%  (${m.maxDdDays} days)`,
      `Skew/Kurt     ${m.skewness.toFixed(3)} / ${m.kurtosis.toFixed(3)}`,
    ].join("\n"), { symbol: args.symbol, ...m });
  },
};

/** Computation tools (require cached data from local tools). */
export const COMPUTE_TOOLS: AgentTool[] = [
  computeFactorTool,
  runBacktestTool,
  checkRiskTool,
  ...QUANT_FUND_DCA_TOOLS,
  ...QUANT_BENCHMARK_TOOLS,
];
