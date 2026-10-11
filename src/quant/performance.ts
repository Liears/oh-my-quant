/** Shared, deterministic return metrics. Inputs are periodic simple returns, without an initial snapshot row. */
export interface PerformanceOptions {
  periodsPerYear?: number;
  elapsedYears?: number;
  riskFreeAnnual?: number;
}

export interface BacktestReport {
  totalReturn: number;
  cagr: number;
  annualVol: number;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  maxDrawdown: number;
  maxDdDays: number;
  winRate: number;
  pnlRatio: number | null;
  excessReturn?: number;
  trackingError?: number;
}

export function validateReturns(returns: number[]): void {
  if (!returns.length || returns.some(r => !Number.isFinite(r) || r < -1))
    throw new Error("Returns must be nonempty, finite simple returns >= -1.");
}

export function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sampleDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

export function calendarYears(dates: string[]): number {
  if (dates.length < 2) throw new Error("At least two valuation dates are required.");
  const times = dates.map(date => {
    const time = Date.parse(date + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date)
      throw new Error("Invalid valuation date.");
    return time;
  });
  if (times.some((time, i) => i > 0 && time <= times[i - 1]))
    throw new Error("Valuation dates must be unique and increasing.");
  return (times[times.length - 1] - times[0]) / (365.25 * 86400000);
}

export function annualReturn(returns: number[], options: PerformanceOptions = {}): number {
  validateReturns(returns);
  const frequency = options.periodsPerYear ?? 252;
  const years = options.elapsedYears ?? returns.length / frequency;
  if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(years) || years <= 0)
    throw new Error("Annualization frequency and elapsed years must be positive.");
  const value = Math.expm1(returns.reduce((sum, r) => sum + Math.log1p(r), 0) / years);
  if (!Number.isFinite(value)) throw new Error("Annualized return exceeds the supported numeric range.");
  return value;
}

export function maxDrawdown(returns: number[]): number {
  validateReturns(returns);
  let equity = 1, peak = 1, worst = 0;
  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, equity / peak - 1);
  }
  return worst;
}

export function maxDdDuration(returns: number[]): number {
  validateReturns(returns);
  let equity = 1, peak = 1, duration = 0, longest = 0;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity >= peak - Math.abs(peak) * 1e-12) {
      peak = Math.max(peak, equity);
      duration = 0;
    } else {
      duration++;
      longest = Math.max(longest, duration);
    }
  }
  return longest;
}

export function sharpe(returns: number[], rf = 0.02, frequency = 252): number | null {
  validateReturns(returns);
  if (!Number.isFinite(rf) || rf <= -1 || !Number.isFinite(frequency) || frequency <= 0)
    throw new Error("Invalid risk-free rate or annualization frequency.");
  const deviation = sampleDeviation(returns);
  if (returns.length < 2 || deviation === 0) return null;
  return (mean(returns) - Math.expm1(Math.log1p(rf) / frequency)) / deviation * Math.sqrt(frequency);
}

/** Lower partial second moment over all observations, relative to a periodic target. */
export function downsideDeviation(returns: number[], target = 0): number {
  validateReturns(returns);
  if (!Number.isFinite(target)) throw new Error("Invalid downside target.");
  return Math.sqrt(mean(returns.map(r => Math.min(r - target, 0) ** 2)));
}

export function sortino(returns: number[], targetAnnual = 0, frequency = 252): number | null {
  validateReturns(returns);
  if (!Number.isFinite(targetAnnual) || targetAnnual <= -1 || !Number.isFinite(frequency) || frequency <= 0)
    throw new Error("Invalid downside target or annualization frequency.");
  const target = Math.expm1(Math.log1p(targetAnnual) / frequency);
  const downside = downsideDeviation(returns, target);
  return downside === 0 ? null : (mean(returns) - target) / downside * Math.sqrt(frequency);
}

export function calmar(returns: number[], options: PerformanceOptions = {}): number | null {
  const cagr = annualReturn(returns, options);
  const drawdown = Math.abs(maxDrawdown(returns));
  return drawdown === 0 ? null : cagr / drawdown;
}

export function winRate(returns: number[]): number {
  validateReturns(returns);
  const active = returns.filter(r => r !== 0);
  return active.length ? active.filter(r => r > 0).length / active.length : 0;
}

export function profitLossRatio(returns: number[]): number | null {
  validateReturns(returns);
  const wins = returns.filter(r => r > 0), losses = returns.filter(r => r < 0);
  if (!losses.length) return null;
  return wins.length ? mean(wins) / -mean(losses) : 0;
}

export function report(returns: number[], benchmarkReturns?: number[], options: PerformanceOptions = {}): BacktestReport {
  const cagr = annualReturn(returns, options);
  const frequency = options.periodsPerYear ?? 252;
  const result: BacktestReport = {
    totalReturn: Math.expm1(returns.reduce((sum, r) => sum + Math.log1p(r), 0)),
    cagr,
    annualVol: sampleDeviation(returns) * Math.sqrt(frequency),
    sharpe: sharpe(returns, options.riskFreeAnnual ?? 0.02, frequency),
    sortino: sortino(returns, 0, frequency),
    calmar: calmar(returns, options),
    maxDrawdown: maxDrawdown(returns),
    maxDdDays: maxDdDuration(returns),
    winRate: winRate(returns),
    pnlRatio: profitLossRatio(returns),
  };
  if (benchmarkReturns) {
    validateReturns(benchmarkReturns);
    if (benchmarkReturns.length !== returns.length)
      throw new Error("Strategy and benchmark returns must cover the same periods.");
    result.excessReturn = cagr - annualReturn(benchmarkReturns, options);
    result.trackingError = sampleDeviation(returns.map((r, i) => r - benchmarkReturns[i])) * Math.sqrt(frequency);
  }
  return result;
}
