import type { FactorName } from "./factor.ts";

/** The observed factor window contains no post-signal outcome test. */
export function factorEvidenceBoundary(factor: FactorName): string {
  const method = factor === "momentum" ? "Momentum is close[t] / close[t-N] - 1, a trailing price return. N return intervals require N+1 consecutive closing observations (N=2 requires 3 closes). "
    : factor === "reversal" ? "The reversal factor is the negative of close[t] / close[t-N] - 1, not an observed price reversal. N return intervals require N+1 consecutive closing observations (N=2 requires 3 closes). "
    : factor === "rsi" ? "RSI uses Wilder averages seeded by the first N changes; each following close updates its own RSI once. It is a 0..100 index, not a return percentage. Positive average gain with zero average loss produces RSI 100; sustained gains are valid sample behavior, not a seeding error. "
    : factor === "volatility" ? "Factor volatility is the rolling sample standard deviation of N returns (N-1 denominator), without annualization here. N return intervals require N+1 consecutive closing observations (N=2 requires 3 closes). It measures historical return dispersion, one aspect of risk; being unannualized does not make it cease to be a risk measure. It does not measure every kind of risk or predict future losses. Under explicitly justified regular observation frequency and uncorrelated-return assumptions, standard deviation * sqrt(periodsPerYear) is a separately labelled annualized convention, not this raw factor value. Unannualized here does not mean annualization is mathematically prohibited. Consecutive observed dates do not prove actual trading-day coverage or those assumptions. "
    : factor === "volume_ratio" ? "Volume ratio divides current volume by the N-observation mean including current volume; it is a dimensionless ratio. Including current volume does not force the ratio to equal one. A value of one means current volume equals the positive window mean; constant positive volume is one sufficient case, not the only case. "
    : "SMA deviation is (SMA(5) - SMA(N)) / SMA(N); both windows must be available. It is not close-price deviation from a moving average. ";
  return method + "Latest, prior mean and prior percentile summarize values inside the selected historical window. "
    + "They do not test subsequent returns, mean reversion, or a predictive trading edge.";
}
