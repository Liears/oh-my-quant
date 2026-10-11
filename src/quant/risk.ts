/**
 * Risk metrics — pure functions, no I/O.
 * Ported from skills/risk/scripts/risk_metrics.py
 */

import type { RiskMetrics } from "../types/risk.ts";
import { downsideDeviation, maxDrawdown, maxDdDuration, validateReturns } from "./performance.ts";
export type { RiskMetrics } from "../types/risk.ts";

export const RISK_EVIDENCE_BOUNDARY = "Volatility and zero-target downside deviation use 252-period annualization. Historical VaR is the sample lower-return quantile; CVaR averages sample returns at or below it, including every tie at the quantile, so its actual sample tail can exceed 5%. These signed per-period returns are not annualized or a bound on future loss. Drawdown duration counts the longest consecutive observations below a prior peak, not calendar days or the duration of the deepest drawdown.";

export function metrics(returns: number[], periodsPerYear = 252): RiskMetrics {
  validateReturns(returns);
  if (!Number.isFinite(periodsPerYear) || periodsPerYear <= 0) throw new Error("Annualization frequency must be positive.");
  const valid = returns;
  const n = valid.length;
  if (n < 2) throw new Error("Need at least 2 valid returns");

  const mean = valid.reduce((a, b) => a + b, 0) / n;
  const variance = valid.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);

  const annualVol = std * Math.sqrt(periodsPerYear);

  const downsideVol = downsideDeviation(valid) * Math.sqrt(periodsPerYear);

  // Historical VaR
  const sorted = [...valid].sort((a, b) => a - b);
  const var95 = percentile(sorted, 0.05);
  const var99 = percentile(sorted, 0.01);
  const var95Parametric = mean - 1.645 * std; // normal assumption

  // CVaR (expected shortfall)
  const cvar95 = sorted.filter((r) => r <= var95).reduce((a, b) => a + b, 0) /
    Math.max(1, sorted.filter((r) => r <= var95).length);
  const cvar99 = sorted.filter((r) => r <= var99).reduce((a, b) => a + b, 0) /
    Math.max(1, sorted.filter((r) => r <= var99).length);

  // Drawdown
  const maxDD = maxDrawdown(valid);
  const maxDDDays = maxDdDuration(valid);

  // Higher moments
  const m3 = valid.reduce((s, v) => s + (v - mean) ** 3, 0) / n;
  const m4 = valid.reduce((s, v) => s + (v - mean) ** 4, 0) / n;
  const populationDeviation = Math.sqrt(variance * (n - 1) / n);
  const skewness = populationDeviation > 0 ? m3 / populationDeviation ** 3 : 0;
  const kurtosis = populationDeviation > 0 ? m4 / populationDeviation ** 4 - 3 : 0; // population excess kurtosis

  return {
    annualVol,
    downsideVol,
    var95,
    var99,
    var95Parametric,
    cvar95,
    cvar99,
    maxDrawdown: maxDD,
    maxDdDays: maxDDDays,
    skewness,
    kurtosis,
  };
}

// --- Internal helpers ---

function percentile(sorted: number[], p: number): number {
  const idx = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}
