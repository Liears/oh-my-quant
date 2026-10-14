import type { Bar } from "../types/data.ts";
import type { DailyBarDataset, ResearchContext } from "../types/research-data.ts";
import { selectCompletedBars, validResearchBar } from "./research-data.ts";

function checkPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) throw new Error("Period must be a positive integer");
}

function checkBars(bars: readonly Bar[]): asserts bars is readonly (Bar & { amount: number })[] {
  if (bars.some((bar, i) => !validResearchBar(bar) || (i > 0 && bar.date <= bars[i - 1].date))) {
    throw new Error("Bars must be valid, unique and ascending");
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** True range needs a preceding close; the first bar is a warm-up observation. */
export function atr(bars: readonly Bar[], period = 14, smoothing: "sma" | "wilder" = "wilder"): (number | null)[] {
  checkPeriod(period);
  checkBars(bars);
  if (smoothing !== "sma" && smoothing !== "wilder") throw new Error("Unknown ATR smoothing");
  const result: (number | null)[] = bars.map(() => null);
  const ranges = bars.slice(1).map((b, i) => Math.max(b.high - b.low,
    Math.abs(b.high - bars[i].close), Math.abs(b.low - bars[i].close)));
  if (ranges.length < period) return result;
  let value = ranges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period] = value;
  for (let i = period; i < ranges.length; i++) {
    value = smoothing === "wilder" ? (value * (period - 1) + ranges[i]) / period
      : ranges.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    result[i + 1] = value;
  }
  return result;
}

export function closeLocationEfficiency(bar: Bar): number | null {
  if (!validResearchBar(bar)) throw new Error("Invalid OHLCV bar");
  return bar.high === bar.low ? null : (bar.close - bar.low) / (bar.high - bar.low);
}

/** Current volume divided by the median of preceding completed bars, excluding current. */
export function precedingVolumeRatio(bars: readonly Bar[], period = 20): number | null {
  checkPeriod(period);
  checkBars(bars);
  if (bars.length < period + 1) return null;
  const baseline = median(bars.slice(-period - 1, -1).map((b) => b.volume));
  return baseline > 0 ? bars.at(-1)!.volume / baseline : null;
}

/** CNY, only when the caller has verified the provider's amount unit. */
export function medianTradedAmount(bars: readonly Bar[], period = 20): number | null {
  checkPeriod(period);
  checkBars(bars);
  return bars.length < period ? null : median(bars.slice(-period).map((b) => b.amount));
}

/** Percentage-point excess return on an exact verified N-session window, no forward fill. */
export function relativeStrength(stock: DailyBarDataset, benchmark: DailyBarDataset, context: ResearchContext, period = 20) {
  checkPeriod(period);
  const s = selectCompletedBars(stock, context);
  const b = selectCompletedBars(benchmark, context);
  const dates = context.calendar.sessions.slice(-period - 1);
  const stockByDate = new Map(s.bars.map((bar) => [bar.date, bar]));
  const benchmarkByDate = new Map(b.bars.map((bar) => [bar.date, bar]));
  const issues = [...s.issues.map((i) => `stock:${i}`), ...b.issues.map((i) => `benchmark:${i}`)];
  if (stock.market !== benchmark.market) issues.push("different_markets");
  if (stock.adjustment.basis !== benchmark.adjustment.basis) issues.push("different_adjustment_basis");
  if (dates.length !== period + 1 || dates.some((d) => !stockByDate.has(d) || !benchmarkByDate.has(d))) {
    issues.push("missing_aligned_sessions");
  }
  if (issues.length) return { status: "data_insufficient" as const, rsPp: null, issues };
  const start = dates[0];
  const end = dates.at(-1)!;
  const stockReturn = stockByDate.get(end)!.close / stockByDate.get(start)!.close - 1;
  const benchmarkReturn = benchmarkByDate.get(end)!.close / benchmarkByDate.get(start)!.close - 1;
  return { status: "ready" as const, rsPp: (stockReturn - benchmarkReturn) * 100,
    stockReturn, benchmarkReturn, start, end, period, benchmark: benchmark.symbol, issues };
}

/** Dataset-aware entry point; exclusions are visible and missing sessions never get bridged. */
export function analyzePriceVolume(dataset: DailyBarDataset, context: ResearchContext, period = 20, atrPeriod = 14,
  smoothing: "sma" | "wilder" = "wilder") {
  checkPeriod(period);
  checkPeriod(atrPeriod);
  const selection = selectCompletedBars(dataset, context);
  const needed = Math.max(period + 1, atrPeriod + 1);
  const byDate = new Map(selection.bars.map((bar) => [bar.date, bar]));
  const bars: Bar[] = [];
  // Preserve Wilder's seed/history, but never calculate through an unverified gap.
  for (const date of [...context.calendar.sessions].reverse()) {
    const bar = byDate.get(date);
    if (!bar) break;
    bars.push(bar);
  }
  bars.reverse();
  const issues = [...selection.issues];
  if (dataset.units.amount !== "CNY" || !["shares", "lots", "units"].includes(dataset.units.volume)) {
    issues.push("unverified_volume_amount_units");
  }
  if (bars.length < needed) issues.push("missing_feature_sessions");
  if (issues.length) return { status: "data_insufficient" as const, issues, excluded: selection.excluded, metrics: null };
  return { status: "ready" as const, issues, excluded: selection.excluded,
    metrics: { asOfSession: bars.at(-1)!.date, historyStart: bars[0].date, historyObservations: bars.length,
      atr: atr(bars, atrPeriod, smoothing).at(-1)!, atrPeriod, smoothing,
      closeLocationEfficiency: closeLocationEfficiency(bars.at(-1)!),
      precedingVolumeRatio: precedingVolumeRatio(bars, period),
      medianAmount: medianTradedAmount(bars, period), amountUnit: "CNY" as const, period } };
}
