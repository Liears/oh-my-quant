import type { PortfolioComparisonInput, PortfolioComparisonResult } from "../types/portfolio-comparison.ts";
import { compareTotalReturns } from "./relative-return.ts";

/** Current explanations derive from the executed method, including when displaying a verified older archive. */
export function comparisonWarning(weighting: PortfolioComparisonInput["weighting"]): string {
  const method = weighting === "buy-and-hold"
    ? "Buy-and-hold: initial allocations determine fixed fractional quantities; no rebalancing. Weights may drift with prices and FX."
    : "Rebalance: restore the specified target weights at common valuation dates for the next interval; no trades are modeled on omitted dates.";
  return `Hypothetical allocations, not account holdings. No fees, taxes, dividends or corporate-action repair. ${method} Annualized risk approximates irregular observation intervals; VaR is per interval, not necessarily one trading day. Daily closes across markets are not simultaneous; FX is a reference rate, not an execution quote.`;
}

export function comparisonMethodNotes(result: PortfolioComparisonResult): string[] {
  let shortest = Infinity, longest = 0;
  for (let index = 1; index < result.dates.length; index++) {
    const days = (Date.parse(`${result.dates[index]}T00:00:00Z`) - Date.parse(`${result.dates[index - 1]}T00:00:00Z`)) / 86400000;
    shortest = Math.min(shortest, days); longest = Math.max(longest, days);
  }
  return [`${result.dates.length} common valuation dates form ${result.dates.length - 1} adjacent return intervals.`,
    `Observed intervals span ${shortest} to ${longest} calendar days${shortest === longest ? "." : "; unequal durations are not normalized before estimating risk."} Calendar coverage and statistical reliability are not established by the number of dates.`,
    "Total return = final NAV / initial NAV - 1. Excess return = portfolio total return - benchmark total return (percentage-point difference), not risk-adjusted alpha. Label tables Excess return (pp), not alpha or α: this tool does not estimate alpha. Return differences do not establish a causal risk/reward tradeoff.",
    ...result.groups.map((group, index) => {
      const relative = compareTotalReturns(group.totalReturn, result.benchmark.totalReturn);
      return `Portfolio ${index === 0 ? "A" : "B"} vs benchmark ${result.input.benchmark}: total return ${Number((group.totalReturn * 100).toPrecision(12))}% vs ${Number((result.benchmark.totalReturn * 100).toPrecision(12))}%; excess return ${Number((relative.excessReturn * 100).toPrecision(12))} pp; ${relative.direction}.`;
    }),
    ...(result.input.weighting === "buy-and-hold" ? result.groups.map((group, index) =>
      `Portfolio ${index === 0 ? "A" : "B"}: ${group.members.length === 1
        ? "one included member retains 100% internal weight, even when its base-currency price changes."
        : "multiple included members may have weights drift with their relative base-currency prices; initial fractional quantities remain fixed."}`) : []),
    "Benchmark direction uses unrounded same-period, same-currency total returns, with absolute tolerance 1e-12 for floating point noise. Display rounding does not establish a tie or risk-adjusted superiority.",
    `CAGR = (final NAV / initial NAV)^(1 / elapsed years) - 1; elapsed years = actual calendar days / 365.25 = ${result.assumptions.elapsedYears}. Risk annualization uses ${result.assumptions.periodsPerYear} common intervals/year.`,
    "Sharpe = mean interval excess return / sample return standard deviation * sqrt(common intervals/year), using a zero risk-free rate here. Zero observed drawdown does not determine or cause a high Sharpe. Sharpe, volatility and interval VaR/CVaR are descriptive sample estimates, not validated forecasts or evidence of superior risk-adjusted performance. No uncertainty or serial-correlation adjustment is computed; disclose the sample count and interval lengths when interpreting them, especially with sparse observations.",
    "Maximum drawdown covers observed valuations only; omitted dates and intraday losses are unknown. Zero observed drawdown does not mean zero risk.",
    comparisonWarning(result.input.weighting)];
}
