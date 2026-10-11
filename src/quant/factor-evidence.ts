import type { FactorName } from "./factor.ts";

/** The observed factor window contains no post-signal outcome test. */
export function factorEvidenceBoundary(factor: FactorName): string {
  const method = factor === "momentum" ? "Momentum is a trailing price return. "
    : factor === "reversal" ? "The reversal factor is the negative of a trailing price return, not an observed price reversal. " : "";
  return method + "Latest, prior mean and prior percentile summarize values inside the selected historical window. "
    + "They do not test subsequent returns, mean reversion, or a predictive trading edge.";
}
