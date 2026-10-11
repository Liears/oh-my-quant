/** Independent monthly price-ratio reconciliation of a pinned public macro run. */
export const MACRO_ETFS = ["RSP", "SPY", "IWM", "TLT", "SHY", "HYG", "LQD", "XLY", "XLP"] as const;
export type MacroEtf = typeof MACRO_ETFS[number];

export interface MacroPriceBar {
  date: string;
  close: number;
}
export interface MacroInputReceipt { rows: number; oldestDate: string; latestDate: string }

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

/** Validates the exact most-recent-first OHLCV response seen by the instrumented price client. */
export function parseMacroInput(raw: unknown, symbol: MacroEtf): { bars: MacroPriceBar[]; receipt: MacroInputReceipt } {
  const payload = object(raw), history = payload?.historical;
  if (payload?.symbol !== symbol || !Array.isArray(history) || history.length < 400 || history.length > 900)
    throw new Error(`Invalid pinned macro ${symbol} input scope or coverage.`);
  const bars: MacroPriceBar[] = [];
  for (const value of history) {
    const row = object(value), day = row?.date;
    if (!row || !validDate(day) || bars.length && day >= bars.at(-1)!.date)
      throw new Error(`Invalid pinned macro ${symbol} input date order.`);
    const numbers = [row.open, row.high, row.low, row.close, row.adjClose];
    if (numbers.some(number => typeof number !== "number" || !Number.isFinite(number) || number <= 0)
      || typeof row.volume !== "number" || !Number.isFinite(row.volume) || row.volume < 0
      || (row.high as number) < (row.low as number) || (row.open as number) < (row.low as number)
      || (row.open as number) > (row.high as number) || (row.close as number) < (row.low as number)
      || (row.close as number) > (row.high as number) || Math.abs((row.adjClose as number) - (row.close as number)) > 1e-8)
      throw new Error(`Invalid pinned macro ${symbol} adjusted OHLCV row.`);
    bars.push({ date: day, close: row.adjClose as number });
  }
  return { bars, receipt: { rows: bars.length, oldestDate: bars.at(-1)!.date, latestDate: bars[0]!.date } };
}

export type MacroPair = { component: string; numerator: MacroEtf; denominator: MacroEtf; ratioField: "current_ratio" | "proxy_ratio" };
export const MACRO_PAIRS: readonly MacroPair[] = [
  { component: "concentration", numerator: "RSP", denominator: "SPY", ratioField: "current_ratio" },
  { component: "yield_curve", numerator: "SHY", denominator: "TLT", ratioField: "proxy_ratio" },
  { component: "credit_conditions", numerator: "HYG", denominator: "LQD", ratioField: "current_ratio" },
  { component: "size_factor", numerator: "IWM", denominator: "SPY", ratioField: "current_ratio" },
  { component: "equity_bond", numerator: "SPY", denominator: "TLT", ratioField: "current_ratio" },
  { component: "sector_rotation", numerator: "XLY", denominator: "XLP", ratioField: "current_ratio" },
];

export function macroMonthlyBars(bars: MacroPriceBar[]): MacroPriceBar[] {
  const seen = new Set<string>();
  return bars.filter(bar => { const month = bar.date.slice(0, 7); if (seen.has(month)) return false; seen.add(month); return true; });
}

export function macroRatioSeries(numerator: MacroPriceBar[], denominator: MacroPriceBar[]): Array<{ date: string; value: number }> {
  const lookup = new Map(macroMonthlyBars(denominator).map(bar => [bar.date.slice(0, 7), bar.close]));
  return macroMonthlyBars(numerator).flatMap(bar => { const close = lookup.get(bar.date.slice(0, 7));
    return close === undefined ? [] : [{ date: bar.date, value: bar.close / close }]; });
}

function matchesRounded(value: unknown, expected: number | null, places: number): boolean {
  if (expected === null) return value === null;
  return typeof value === "number" && Number.isFinite(value)
    && Math.abs(value - expected) <= 0.5 * 10 ** -places + 1e-8;
}

/** Reconstructs six monthly ratios and their key window statistics from captured adjusted close prices. */
export function auditMacroReportFromInputs(rawReport: unknown, inputs: Record<MacroEtf, MacroPriceBar[]>): string[] {
  const report = object(rawReport), components = object(report?.components);
  if (!components) return ["missing-macro-components"];
  const issues: string[] = [];
  for (const pair of MACRO_PAIRS) {
    const item = object(components[pair.component]), numerator = inputs[pair.numerator], denominator = inputs[pair.denominator];
    if (!item || item.data_available !== true || !numerator?.length || !denominator?.length) {
      issues.push(`missing-input-or-component-${pair.component}`); continue;
    }
    const series = macroRatioSeries(numerator, denominator), values = series.map(point => point.value);
    if (series.length < 13) { issues.push(`short-monthly-window-${pair.component}`); continue; }
    const current = values[0]!, sma6 = values.slice(0, 6).reduce((sum, value) => sum + value, 0) / 6;
    const sma12 = values.slice(0, 12).reduce((sum, value) => sum + value, 0) / 12;
    const roc3 = (current - values[3]!) / values[3]! * 100;
    const roc12 = (current - values[12]!) / values[12]! * 100;
    const percentile = values.filter(value => value < current).length / values.length * 100;
    if (item.current_date !== series[0]!.date || item.monthly_points !== series.length
      || !matchesRounded(item[pair.ratioField], current, 4) || !matchesRounded(item.sma_6m, sma6, 4)
      || !matchesRounded(item.sma_12m, sma12, 4) || !matchesRounded(item.roc_3m, roc3, 2)
      || !matchesRounded(item.roc_12m, roc12, 2) || !matchesRounded(item.percentile, percentile, 1))
      issues.push(`wrong-monthly-ratio-or-window-${pair.component}`);
  }
  return issues;
}
