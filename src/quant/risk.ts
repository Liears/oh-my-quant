/**
 * Risk metrics — pure functions, no I/O.
 * Ported from skills/risk/scripts/risk_metrics.py
 */

import type { RiskMetrics } from "../types/risk.ts";
import { downsideDeviation, maxDrawdown, maxDdDuration, validateReturns } from "./performance.ts";
import { mean as arithmeticMean, sampleDeviation, distributionShape, finiteStatistic } from "./statistics.ts";
export type { RiskMetrics } from "../types/risk.ts";

export const RISK_EVIDENCE_BOUNDARY = "For N return intervals, annual volatility = sqrt(sum((r - mean(r))^2) / (N - 1)) * sqrt(252). This tool's zero-target downside deviation = sqrt(sum(min(r, 0)^2) / N) * sqrt(252): the denominator includes ALL return intervals, positive returns contribute zero, and negative returns are NOT centered on their own mean. It is not the ordinary standard deviation of daily or negative-only returns. Both annual volatility and downside volatility are annualized by sqrt(252); their centering and denominators differ. Annual volatility uses the mean-centered sample standard deviation (N-1); downside volatility uses the zero-target root mean square over all N returns. Historical VaR is the sample lower-return quantile; CVaR averages sample returns at or below it, including every tie at the quantile, so its actual sample tail can exceed 5%. Only VaR/CVaR here are signed per-period returns, not annualized or a bound on future loss. Maximum drawdown is the largest cumulative peak-to-trough decline in this window, not a single-period return; do not group maximum drawdown with VaR/CVaR as per-period returns. Drawdown duration counts the longest consecutive observations below a prior peak, not calendar days or the duration of the deepest drawdown. A newer data version does not erase this archived window's result; applying the conclusion to changed inputs requires a new calculation.";

export function metrics(returns: number[], periodsPerYear = 252): RiskMetrics {
  validateReturns(returns);
  if (!Number.isFinite(periodsPerYear) || periodsPerYear <= 0) throw new Error("Annualization frequency must be positive.");
  const valid = returns;
  const n = valid.length;
  if (n < 2) throw new Error("Need at least 2 valid returns");

  const mean = arithmeticMean(valid);
  const std = sampleDeviation(valid);

  const annualVol = std * Math.sqrt(periodsPerYear);

  const downsideVol = downsideDeviation(valid) * Math.sqrt(periodsPerYear);

  // Historical VaR
  const sorted = [...valid].sort((a, b) => a - b);
  const var95 = percentile(sorted, 0.05);
  const var99 = percentile(sorted, 0.01);
  const var95Parametric = mean - 1.645 * std; // normal assumption

  // CVaR (expected shortfall)
  const cvar95 = arithmeticMean(sorted.filter((r) => r <= var95));
  const cvar99 = arithmeticMean(sorted.filter((r) => r <= var99));

  // Drawdown
  const maxDD = maxDrawdown(valid);
  const maxDDDays = maxDdDuration(valid);

  // Higher moments
  const { skewness, kurtosis } = distributionShape(valid);

  const result = {
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
  for (const value of Object.values(result)) finiteStatistic(value);
  return result;
}

// --- Internal helpers ---

function percentile(sorted: number[], p: number): number {
  const idx = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}
