/**
 * Factor computation — pure functions, no I/O.
 * Ported from skills/factor/scripts/compute.py
 */

import { rsi } from "./rsi.ts";
import { mean as arithmeticMean, sampleDeviation, standardScores } from "./statistics.ts";
export { rsi } from "./rsi.ts";

/** N-period cumulative return */
export function momentum(close: number[], n = 20): (number | null)[] {
  const result: (number | null)[] = new Array(close.length).fill(null);
  for (let i = n; i < close.length; i++) {
    if (close[i - n] !== 0) {
      result[i] = close[i] / close[i - n] - 1;
    }
  }
  return result;
}

/** Negative N-period return (short-term reversal signal) */
export function reversal(close: number[], n = 5): (number | null)[] {
  const mom = momentum(close, n);
  return mom.map((v) => (v !== null ? -v : null));
}

/** N-period rolling standard deviation of daily returns */
export function volatility(close: number[], n = 20): (number | null)[] {
  const returns = close.map((v, i) => (i > 0 ? (v - close[i - 1]) / close[i - 1] : null));
  return rollingStd(returns, n);
}

/** Current volume / N-period mean volume */
export function volumeRatio(volume: number[], n = 20): (number | null)[] {
  const result: (number | null)[] = new Array(volume.length).fill(null);
  for (let i = n - 1; i < volume.length; i++) {
    const slice = volume.slice(i - n + 1, i + 1);
    const mean = arithmeticMean(slice);
    result[i] = mean > 0 ? volume[i] / mean : null;
  }
  return result;
}

/** (SMA_short - SMA_long) / SMA_long — normalized deviation */
export function smaDeviation(close: number[], short = 5, long = 20): (number | null)[] {
  const shortMA = rollingMean(close, short);
  const longMA = rollingMean(close, long);
  const result: (number | null)[] = new Array(close.length).fill(null);
  for (let i = Math.max(short, long) - 1; i < close.length; i++) {
    if (longMA[i] && longMA[i] !== 0) {
      result[i] = (shortMA[i]! - longMA[i]!) / longMA[i]!;
    }
  }
  return result;
}

// --- Preprocessing ---

/** Clip outliers beyond n_mad * 1.4826 * MAD from the median */
export function winsorize(series: (number | null)[], nMAD = 5): (number | null)[] {
  const valid = series.filter((v): v is number => v !== null);
  if (valid.length === 0) return [...series];

  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const absDev = valid.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = absDev[Math.floor(absDev.length / 2)];
  const threshold = nMAD * 1.4826 * mad;

  const upper = median + threshold;
  const lower = median - threshold;

  return series.map((v) => (v !== null ? Math.max(lower, Math.min(upper, v)) : null));
}

/** Z-score normalization (sample std) */
export function standardize(series: (number | null)[]): (number | null)[] {
  const valid = series.filter((v): v is number => v !== null);
  if (valid.length < 2) return [...series];

  const scores = standardScores(valid);
  let index = 0;
  return series.map(value => value === null ? null : scores[index++]!);
}

// --- Utilities ---

function rollingMean(values: (number | null)[], n: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    const window: number[] = [];
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      if (values[j] === null) { ok = false; break; }
      window.push(values[j]!);
    }
    if (ok) result[i] = arithmeticMean(window);
  }
  return result;
}

function rollingStd(values: (number | null)[], n: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    const window: number[] = [];
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      if (values[j] === null) { ok = false; break; }
      window.push(values[j]!);
    }
    if (!ok || window.length < 2) continue;
    result[i] = sampleDeviation(window);
  }
  return result;
}

/** Available factor names */
export const FACTOR_NAMES = [
  "momentum",
  "reversal",
  "volatility",
  "volume_ratio",
  "rsi",
  "sma_deviation",
] as const;

export type FactorName = (typeof FACTOR_NAMES)[number];

/** Shared preparation/verification minimum, including the fixed SMA(5) window. */
export function factorRequiredBars(factor: FactorName, period: number): number {
  return Math.max(period + 1, factor === "sma_deviation" ? 5 : 0);
}

/** Latest observation compared with preceding valid observations. */
export function summarizeFactor(values: Array<number | null>): { last: number | undefined; mean: number | null; percentile: number | null } {
  const previous = values.filter((value): value is number => value !== null);
  const last = previous.pop();
  const mean = previous.length ? arithmeticMean(previous) : null;
  const percentile = last !== undefined && previous.length ? previous.filter(value => value <= last).length / previous.length : null;
  return { last, mean, percentile };
}

/** Compute a factor by name */
export function computeFactor(
  name: FactorName,
  close: number[],
  volume?: number[],
  period = 20,
): (number | null)[] {
  switch (name) {
    case "momentum": return momentum(close, period);
    case "reversal": return reversal(close, period);
    case "volatility": return volatility(close, period);
    case "volume_ratio": {
      if (!volume) throw new Error("volume_ratio requires volume data");
      return volumeRatio(volume, period);
    }
    case "rsi": return rsi(close, period);
    case "sma_deviation": return smaDeviation(close, 5, period);
  }
}
