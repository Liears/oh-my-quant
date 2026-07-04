export interface RiskMetrics {
  annualVol: number;
  downsideVol: number;
  var95: number;
  var99: number;
  var95Parametric: number;
  cvar95: number;
  cvar99: number;
  maxDrawdown: number;
  maxDdDays: number;
  skewness: number;
  kurtosis: number;
}
