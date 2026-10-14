import {
  smaSignals, vectorizedBacktest, report, calendarYears,
  computeFactor, FACTOR_NAMES, factorRequiredBars, summarizeFactor,
  type FactorName, metrics, RISK_EVIDENCE_BOUNDARY, BENCHMARK_PRICE_BASIS,
  BENCHMARK_PRICE_BASIS_ID, DEFAULT_BENCHMARK_SYMBOL, evaluate, factorEvidenceBoundary,
} from "../quant/index.ts";
import { normalizeSymbol } from "../market/symbols.ts";
import { validateDateRange } from "../market/bars.ts";
import type { ResearchAnalysis, ResearchDataset, ResearchMetric } from "./types.ts";
import { matches } from "./match.ts";
import { verifyAppArchiveBoundary } from "./observation-boundary.ts";
import { priceAdjustmentNote } from "../market/price-adjustment.ts";

/** Canonical acceptance labels shared by verification and task capability discovery. */
export const PRICE_RESEARCH_METRICS = {
  compute_factor: { last: "Latest", mean: "Prior mean", percentile: "Prior percentile" },
  check_risk: { annualVol: "Annual volatility", downsideVol: "Downside volatility", var95: "VaR 95%", cvar95: "CVaR 95%", maxDrawdown: "Maximum drawdown", maxDdDays: "Drawdown duration" },
  run_backtest: { totalReturn: "Total return", cagr: "CAGR", sharpe: "Sharpe", sortino: "Sortino", maxDrawdown: "Maximum drawdown" },
  alpha_backtest: { totalReturn: "Total return", cagr: "CAGR", sharpe: "Sharpe", annualVol: "Annual volatility", maxDrawdown: "Maximum drawdown" },
  alpha_runs: { totalReturn: "Total return", cagr: "CAGR", sharpe: "Sharpe", annualVol: "Annual volatility", maxDrawdown: "Maximum drawdown" },
} as const;

function metric(label: string, value: number | null, unit: ResearchMetric["unit"] = "percent"): ResearchMetric {
  return { label, value, unit };
}

export function verifyResearchAnalysis(name: string, args: Record<string, unknown>, saved: Record<string, unknown>, roles: Record<string, number>, datasets: ResearchDataset[]): ResearchAnalysis {
  const primaryIndex = roles[name === "score_benchmark" ? "strategy" : "input"];
  const primary = primaryIndex === undefined ? undefined : datasets[primaryIndex];
  if (!primary || !("bars" in primary) || typeof args.symbol !== "string" || normalizeSymbol(args.symbol) !== primary.ref.symbol) throw new Error("Missing matching dataset");
  const { bars, ref } = primary;
  const close = bars.map(bar => bar.close), dates = bars.map(bar => bar.date);
  if (name !== "score_benchmark" && !matches(saved, { symbol: args.symbol, source: ref.source })) throw new Error("Saved input identity mismatch");
  if (name === "compute_factor" && (args.start !== undefined || args.end !== undefined)) {
    if ((args.start !== undefined && typeof args.start !== "string") || (args.end !== undefined && typeof args.end !== "string")) throw new Error("Invalid requested factor dates");
    validateDateRange(args.start as string | undefined, args.end as string | undefined);
    if ((args.start !== undefined && args.start !== ref.requested.start) || (args.end ?? null) !== ref.requested.end) throw new Error("Requested factor window mismatch");
  }
  if (name === "check_risk" || name === "run_backtest") {
    if ((args.start !== undefined && typeof args.start !== "string") || (args.end !== undefined && typeof args.end !== "string")) throw new Error("Invalid requested dates");
    validateDateRange(args.start as string | undefined, args.end as string | undefined);
    if ((args.start !== undefined && args.start !== ref.requested.start) || (args.end ?? null) !== ref.requested.end
      || !matches(saved, { start: dates[0], end: dates.at(-1) })) throw new Error("Requested or saved window mismatch");
  }
  const priceTool = name === "compute_factor" || name === "run_backtest" || name === "check_risk";
  if (priceTool && args.observed_before === undefined && (saved.archiveRequest !== undefined
    || saved.historicalBoundary !== undefined || saved.historicalAvailability === "app-archive-observed-before"))
    throw new Error("Archived output was not requested with an observation cutoff");
  const archiveAssumption = priceTool && args.observed_before !== undefined
    ? verifyAppArchiveBoundary(args, saved, roles, datasets) : null;
  const base = { datasetIndexes: [primaryIndex!], assumptions: [priceAdjustmentNote(ref.adjustment), "Observations recorded at fetch time; provider publication and complete trading days unverified.",
    ...(archiveAssumption ? [archiveAssumption] : [])] };
  if (name === "compute_factor") {
    const period = args.period ?? 20;
    if (!FACTOR_NAMES.includes(args.factor as FactorName) || typeof period !== "number" || !Number.isInteger(period) || period < 1
      || bars.length < factorRequiredBars(args.factor as FactorName, period)) throw new Error("Invalid factor parameters");
    const factor = args.factor as FactorName;
    const result = summarizeFactor(computeFactor(factor, close, bars.map(bar => bar.volume), period));
    if (!matches(saved, { factor, period, asOfDate: dates.at(-1), ...result })) throw new Error("Factor result mismatch");
    const labels = PRICE_RESEARCH_METRICS.compute_factor;
    return { ...base, kind: "factor", title: `${ref.symbol} · ${factor} (${period})`,
      assumptions: [...base.assumptions, factorEvidenceBoundary(factor)],
      metrics: [metric(labels.last, result.last ?? null, "number"), metric(labels.mean, result.mean, "number"), metric(labels.percentile, result.percentile)] };
  }
  if (name === "check_risk") {
    if (bars.length < 30) throw new Error("Insufficient risk data");
    const result = metrics(close.slice(1).map((value, i) => value / close[i]! - 1));
    if (!matches(saved, result)) throw new Error("Risk result mismatch");
    const labels = PRICE_RESEARCH_METRICS.check_risk;
    return { ...base, kind: "risk", title: `${ref.symbol} · Risk`,
      assumptions: [...base.assumptions, RISK_EVIDENCE_BOUNDARY],
      metrics: [metric(labels.annualVol, result.annualVol), metric(labels.downsideVol, result.downsideVol), metric(labels.var95, result.var95), metric(labels.cvar95, result.cvar95), metric(labels.maxDrawdown, result.maxDrawdown), metric(labels.maxDdDays, result.maxDdDays, "periods")],
    };
  }
  const fast = args.fast ?? 20, slow = args.slow ?? 60, cash = args.cash ?? 100_000, commission = args.commission ?? 0.0003, stampDuty = args.stamp_duty ?? 0;
  if ([fast, slow, cash, commission, stampDuty].some(value => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Invalid backtest parameters");
  const run = (prices: number[]) => vectorizedBacktest(smaSignals(prices, fast as number, slow as number), prices, cash as number, commission as number, stampDuty as number);
  const assumptions = [...base.assumptions, `SMA(${fast},${slow}); commission ${commission}; sell duty ${stampDuty}.`, "Prior signal at next close; fractional shares; no slippage. Normalized initial value 1.", "Calendar/365.25 CAGR; 252-period volatility and ratios; 2% annual risk-free rate."];
  if (name === "run_backtest") {
    if (bars.length < (slow as number) + 10) throw new Error("Insufficient backtest data");
    const ledger = run(close);
    const result = report(ledger.returns.slice(1), undefined, { elapsedYears: calendarYears(dates) });
    if (!matches(saved, { dates, ledger, ...result, assumptions: { commission, stampDuty, elapsedYears: calendarYears(dates), periodsPerYear: 252, execution: "next-close", fractionalShares: true, slippage: 0 } })) throw new Error("Backtest result mismatch");
    const labels = PRICE_RESEARCH_METRICS.run_backtest;
    return { ...base, kind: "backtest", title: `${ref.symbol} · SMA(${fast},${slow})`, assumptions,
      metrics: [metric(labels.totalReturn, result.totalReturn), metric(labels.cagr, result.cagr), metric(labels.sharpe, result.sharpe, "number"), metric(labels.sortino, result.sortino, "number"), metric(labels.maxDrawdown, result.maxDrawdown)],
      curve: { dates, values: ledger.equity.map(value => value / ledger.equity[0]!) },
    };
  }
  const benchmarkIndex = roles.benchmark, benchmark = benchmarkIndex === undefined ? undefined : datasets[benchmarkIndex];
  const benchmarkSymbol = args.benchmark_symbol ?? DEFAULT_BENCHMARK_SYMBOL;
  if (!benchmark || !("bars" in benchmark) || typeof benchmarkSymbol !== "string" || normalizeSymbol(benchmarkSymbol) !== benchmark.ref.symbol) throw new Error("Missing benchmark input");
  if (saved.assumptions && typeof saved.assumptions === "object" && "priceBasis" in saved.assumptions
    && saved.assumptions.priceBasis !== BENCHMARK_PRICE_BASIS_ID) throw new Error("Benchmark price basis mismatch");
  const benchmarkByDate = new Map(benchmark.bars.map(bar => [bar.date, bar.close]));
  const aligned = bars.filter(bar => benchmarkByDate.has(bar.date));
  const commonDates = aligned.map(bar => bar.date), strategyClose = aligned.map(bar => bar.close), benchmarkClose = commonDates.map(date => benchmarkByDate.get(date)!);
  if (aligned.length < Math.ceil(((slow as number) + 10) / 0.3)) throw new Error("Insufficient common dates");
  const split = Math.floor(aligned.length * 0.7), ledger = run(strategyClose);
  const result = evaluate(
    { returns: ledger.returns.slice(1), dates: commonDates },
    { returns: benchmarkClose.slice(1).map((value, i) => value / benchmarkClose[i]! - 1), dates: commonDates },
    { returns: run(strategyClose.slice(0, split)).returns.slice(1), dates: commonDates.slice(0, split) },
    { returns: run(strategyClose.slice(split)).returns.slice(1), dates: commonDates.slice(split) },
  );
  if (!matches(saved, { dates: commonDates, ...result })) throw new Error("Benchmark result mismatch");
  return { kind: "benchmark", title: `${ref.symbol} vs ${benchmark.ref.symbol} · SMA(${fast},${slow})`, datasetIndexes: [primaryIndex!, benchmarkIndex!],
    assumptions: [...assumptions, `Benchmark ${benchmark.ref.symbol}: ${priceAdjustmentNote(benchmark.ref.adjustment)}`,
      "Gross buy-and-hold benchmark; 70/30 independent train/test restart; observed calendar months include partial months.", BENCHMARK_PRICE_BASIS],
    metrics: [metric("Score / 100", result.totalScore, "number"), metric("Return / 40", result.returnScore, "number"), metric("Risk / 40", result.riskScore, "number"), metric("Robustness / 20", result.robustnessScore, "number"), metric("CAGR", result.details.cagr), metric("Excess CAGR", result.details.excessReturn), metric("Sharpe", result.details.sharpe, "number"), metric("Maximum drawdown", result.details.maxDrawdown)],
    curve: { dates: commonDates, values: ledger.equity.map(value => value / ledger.equity[0]!), benchmark: benchmarkClose.map(value => value / benchmarkClose[0]!) },
  };
}
