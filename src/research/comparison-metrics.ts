/** Canonical series and metric labels shared by verification and declaration-time discovery. */
export const COMPARISON_COMMON_METRIC = "Common dates";
export const COMPARISON_SERIES_METRICS = {
  totalReturn: "Total return", cagr: "CAGR", sharpe: "Sharpe (RF 0)", maxDrawdown: "Max drawdown",
  excessReturn: "Excess return", annualVol: "Annual volatility", downsideVol: "Downside volatility",
  var95: "VaR 95% / interval", cvar95: "CVaR 95% / interval",
} as const;

export function comparisonSeriesLabels(benchmark?: string): string[] {
  return ["Portfolio A", "Portfolio B", ...(benchmark ? [`Benchmark · ${benchmark}`] : [])];
}

export function comparisonMetricLabels(benchmark?: string): string[] {
  return [COMPARISON_COMMON_METRIC, ...comparisonSeriesLabels(benchmark)
    .flatMap(series => Object.values(COMPARISON_SERIES_METRICS).map(label => `${series} / ${label}`))];
}
