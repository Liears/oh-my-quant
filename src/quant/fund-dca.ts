import type { FundNavDaily } from "../types/data.ts";
import { isDailyDate, validateDateRange } from "../market/bars.ts";

export type DcaFrequency = "weekly" | "biweekly" | "monthly" | "quarterly";

export interface DcaBacktestOptions {
  startDate?: string;
  endDate?: string;
  frequency?: DcaFrequency;
  investAmount?: number;
  investDay?: number;
  purchaseFeeRate?: number;
  purchaseFeeUnit?: "decimal" | "percent" | "auto";
}

export interface DcaTradeRecord {
  scheduledDate: string;
  tradeDate: string;
  nav: number;
  grossAmount: number;
  purchaseFee: number;
  netAmount: number;
  shares: number;
  cumulativeShares: number;
  cumulativePrincipal: number;
}

export interface DcaAccountPoint {
  date: string;
  unitNav: number;
  cumulativePrincipal: number;
  cumulativeShares: number;
  marketValue: number;
  floatingProfit: number;
  returnRate: number;
  /** Cash-flow-adjusted wealth index, starting at 1 before the first purchase fee. */
  performanceIndex: number;
  drawdown: number;
  maxDrawdownToDate: number;
}

export interface DcaBacktestResult {
  methodVersion: 2;
  plan: {
    startDate: string;
    endDate: string;
    frequency: DcaFrequency;
    investAmount: number;
    investDay: number;
    purchaseFeeRate: number;
  };
  summary: {
    tradeCount: number;
    totalPrincipal: number;
    totalPurchaseFee: number;
    totalNetAmount: number;
    totalShares: number;
    finalMarketValue: number;
    profit: number;
    returnRate: number;
    timeWeightedReturn: number;
    xirr: number | null;
    averageCost: number;
    breakevenNav: number;
    maxDrawdown: number;
  };
  trades: DcaTradeRecord[];
  accountCurve: DcaAccountPoint[];
}

const DAY_MS = 86_400_000;

export function runDcaBacktest(navRows: FundNavDaily[], options: DcaBacktestOptions = {}): DcaBacktestResult {
  validateDcaOptions(options);
  if (navRows.some(row => !isDailyDate(row.navDate) || !Number.isFinite(row.unitNav) || row.unitNav <= 0)
    || new Set(navRows.map(row => row.navDate)).size !== navRows.length || new Set(navRows.map(row => row.fundCode)).size > 1) throw new Error("DCA requires valid, unique observations for one fund.");
  const rows = navRows
    .filter((row) => row.navDate && Number.isFinite(row.unitNav) && row.unitNav > 0)
    .sort((a, b) => a.navDate.localeCompare(b.navDate));
  if (rows.length === 0) throw new Error("No NAV rows available for DCA backtest.");

  const latest = rows[rows.length - 1]!;
  if ((options.startDate && options.startDate > latest.navDate) || (options.endDate && options.endDate < rows[0]!.navDate)) throw new Error("No NAV observations within requested dates.");
  const endDate = options.endDate && options.endDate < latest.navDate ? options.endDate : latest.navDate;
  const rawStartDate = options.startDate || shiftYears(endDate, -5);
  const startDate = normalizeStartDate(rawStartDate, rows[0]!.navDate, latest.navDate);
  const frequency = options.frequency || "monthly";
  const investAmount = positive(options.investAmount, 1000);
  const investDay = Math.max(1, Math.floor(options.investDay || defaultInvestDay(frequency)));
  const purchaseFeeRate = normalizeRate(options.purchaseFeeRate ?? 0, options.purchaseFeeUnit);

  const schedules = buildDcaSchedule(startDate, endDate, frequency, investDay);
  const navByDate = new Map(rows.map((row) => [row.navDate, row]));
  let cumulativePrincipal = 0;
  let cumulativeShares = 0;
  let totalPurchaseFee = 0;
  let totalNetAmount = 0;
  const trades: DcaTradeRecord[] = [];

  for (const scheduledDate of schedules) {
    const tradeDate = findNextNavDate(rows, scheduledDate, endDate);
    if (!tradeDate) continue;
    const nav = navByDate.get(tradeDate)!.unitNav;
    const netAmount = investAmount / (1 + purchaseFeeRate);
    const purchaseFee = investAmount - netAmount;
    const shares = netAmount / nav;
    cumulativePrincipal += investAmount;
    cumulativeShares += shares;
    totalPurchaseFee += purchaseFee;
    totalNetAmount += netAmount;
    trades.push({
      scheduledDate,
      tradeDate,
      nav,
      grossAmount: investAmount,
      purchaseFee,
      netAmount,
      shares,
      cumulativeShares,
      cumulativePrincipal,
    });
  }

  const accountCurve = buildAccountCurve(rows, trades, startDate, endDate);
  if (!trades.length) throw new Error("No scheduled purchases within available NAV dates.");
  const finalPoint = accountCurve[accountCurve.length - 1];
  const finalMarketValue = finalPoint?.marketValue ?? 0;
  const profit = finalMarketValue - cumulativePrincipal;
  const cashflows = trades.map((trade) => ({ date: trade.tradeDate, amount: -trade.grossAmount }));
  if (finalPoint) cashflows.push({ date: finalPoint.date, amount: finalMarketValue });

  return {
    methodVersion: 2,
    plan: { startDate, endDate, frequency, investAmount, investDay, purchaseFeeRate },
    summary: {
      tradeCount: trades.length,
      totalPrincipal: cumulativePrincipal,
      totalPurchaseFee,
      totalNetAmount,
      totalShares: cumulativeShares,
      finalMarketValue,
      profit,
      returnRate: cumulativePrincipal > 0 ? profit / cumulativePrincipal : 0,
      timeWeightedReturn: finalPoint!.performanceIndex - 1,
      xirr: calculateXirr(cashflows),
      averageCost: cumulativeShares > 0 ? totalNetAmount / cumulativeShares : 0,
      breakevenNav: cumulativeShares > 0 ? cumulativePrincipal / cumulativeShares : 0,
      maxDrawdown: accountCurve.reduce((min, point) => Math.min(min, point.drawdown), 0),
    },
    trades,
    accountCurve,
  };
}

export function buildDcaSchedule(startDate: string, endDate: string, frequency: DcaFrequency, investDay: number): string[] {
  validateDcaOptions({ startDate, endDate, frequency, investDay });
  const start = parseYmd(startDate);
  const end = parseYmd(endDate);
  let cursor = initialScheduleDate(start, frequency, investDay);
  const dates: string[] = [];
  while (cursor <= end) {
    dates.push(formatYmd(cursor));
    cursor = addFrequency(cursor, frequency, investDay);
  }
  return dates;
}

export function calculateXirr(cashflows: Array<{ date: string; amount: number }>): number | null {
  if (cashflows.length < 2 || cashflows.some(flow => !isDailyDate(flow.date) || !Number.isFinite(flow.amount))) return null;
  const scale = cashflows.reduce((max, flow) => Math.max(max, Math.abs(flow.amount)), 0);
  if (scale === 0) return null;
  const byDate = new Map<string, number>();
  for (const flow of cashflows) byDate.set(flow.date, (byDate.get(flow.date) ?? 0) + flow.amount / scale);
  const flows = [...byDate].filter(([, amount]) => amount !== 0).sort(([a], [b]) => a.localeCompare(b));
  if (flows.length < 2 || !flows.some(([, amount]) => amount < 0) || !flows.some(([, amount]) => amount > 0)) return null;
  const start = parseYmd(flows[0]![0]).getTime();
  const terms = flows.map(([date, amount]) => ({ sign: Math.sign(amount), logAmount: Math.log(Math.abs(amount)), years: (parseYmd(date).getTime() - start) / DAY_MS / 365 }));
  // Solve in log(1 + rate), scaling every NPV evaluation to avoid overflow and amount-dependent tolerances.
  const npv = (logRate: number) => {
    const logs = terms.map(term => term.logAmount - logRate * term.years);
    const max = logs.reduce((a, b) => Math.max(a, b), -Infinity);
    return terms.reduce((sum, term, i) => sum + term.sign * Math.exp(logs[i]! - max), 0);
  };
  let lo = Math.log(Number.EPSILON / 2);
  let hi = Math.log(Number.MAX_VALUE);
  let loVal = npv(lo);
  if (Math.sign(loVal) === Math.sign(npv(hi))) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const midVal = npv(mid);
    if (midVal === 0 || hi - lo < 1e-13) {
      const rate = Math.expm1(mid);
      return Number.isFinite(rate) && rate > -1 ? rate : null;
    }
    if (Math.sign(midVal) === Math.sign(loVal)) {
      lo = mid;
      loVal = midVal;
    } else {
      hi = mid;
    }
  }
  return null;
}

function buildAccountCurve(rows: FundNavDaily[], trades: DcaTradeRecord[], startDate: string, endDate: string): DcaAccountPoint[] {
  let tradeIndex = 0;
  let cumulativePrincipal = 0;
  let cumulativeShares = 0;
  let previousNav: number | undefined;
  let performanceIndex = 1;
  let peakValue = 1;
  let maxDrawdownToDate = 0;
  const curve: DcaAccountPoint[] = [];

  for (const row of rows) {
    if (row.navDate < startDate || row.navDate > endDate) continue;
    const valueBeforeFlow = cumulativeShares * row.unitNav;
    let contribution = 0;
    while (tradeIndex < trades.length && trades[tradeIndex]!.tradeDate <= row.navDate) {
      const trade = trades[tradeIndex++]!;
      contribution += trade.grossAmount;
      cumulativePrincipal = trade.cumulativePrincipal;
      cumulativeShares = trade.cumulativeShares;
    }
    if (cumulativePrincipal <= 0) continue;
    const marketValue = cumulativeShares * row.unitNav;
    // Value old shares before the flow, then isolate the purchase fee after the flow.
    if (previousNav !== undefined) performanceIndex *= row.unitNav / previousNav;
    if (contribution > 0) performanceIndex *= marketValue / (valueBeforeFlow + contribution);
    previousNav = row.unitNav;
    peakValue = Math.max(peakValue, performanceIndex);
    const drawdown = performanceIndex / peakValue - 1;
    maxDrawdownToDate = Math.min(maxDrawdownToDate, drawdown);
    curve.push({
      date: row.navDate,
      unitNav: row.unitNav,
      cumulativePrincipal,
      cumulativeShares,
      marketValue,
      floatingProfit: marketValue - cumulativePrincipal,
      returnRate: marketValue / cumulativePrincipal - 1,
      performanceIndex,
      drawdown,
      maxDrawdownToDate,
    });
  }
  return curve;
}

function findNextNavDate(rows: FundNavDaily[], target: string, endDate: string): string | null {
  let lo = 0;
  let hi = rows.length - 1;
  let found: string | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const date = rows[mid]!.navDate;
    if (date >= target) {
      found = date;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found && found <= endDate ? found : null;
}

function initialScheduleDate(start: Date, frequency: DcaFrequency, investDay: number): Date {
  if (frequency === "weekly" || frequency === "biweekly") {
    const target = investDay % 7;
    const delta = (target - start.getUTCDay() + 7) % 7;
    return new Date(start.getTime() + delta * DAY_MS);
  }
  const day = Math.min(investDay, lastDayOfMonth(start.getUTCFullYear(), start.getUTCMonth()));
  let date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day));
  if (date < start) date = addFrequency(date, frequency, investDay);
  return date;
}

function addFrequency(date: Date, frequency: DcaFrequency, investDay: number): Date {
  if (frequency === "weekly") return new Date(date.getTime() + 7 * DAY_MS);
  if (frequency === "biweekly") return new Date(date.getTime() + 14 * DAY_MS);
  const step = frequency === "quarterly" ? 3 : 1;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + step;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = month % 12;
  const day = Math.min(investDay, lastDayOfMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, day));
}

function defaultInvestDay(frequency: DcaFrequency): number {
  return frequency === "weekly" || frequency === "biweekly" ? 1 : 1;
}

function normalizeRate(rate: number, unit: DcaBacktestOptions["purchaseFeeUnit"] = "auto"): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return unit === "percent" || (unit === "auto" && rate > 0.05) ? rate / 100 : rate;
}

export function validateDcaOptions(options: DcaBacktestOptions): void {
  validateDateRange(options.startDate, options.endDate);
  const frequency = options.frequency ?? "monthly", day = options.investDay ?? 1;
  if (!["weekly", "biweekly", "monthly", "quarterly"].includes(frequency)) throw new Error("Invalid DCA frequency.");
  if (!Number.isInteger(day) || day < 1 || day > (["weekly", "biweekly"].includes(frequency) ? 7 : 31)) throw new Error("Invalid DCA investment day.");
  if (options.investAmount !== undefined && (!Number.isFinite(options.investAmount) || options.investAmount <= 0)) throw new Error("DCA investment amount must be positive.");
  if (options.purchaseFeeUnit !== undefined && !["decimal", "percent", "auto"].includes(options.purchaseFeeUnit)) throw new Error("Invalid DCA fee unit.");
  if (options.purchaseFeeRate !== undefined && (!Number.isFinite(options.purchaseFeeRate) || options.purchaseFeeRate < 0 || normalizeRate(options.purchaseFeeRate, options.purchaseFeeUnit) >= 1)) throw new Error("Invalid DCA purchase fee.");
}

function positive(value: number | undefined, fallback: number): number {
  return value && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeStartDate(date: string, firstNavDate: string, latestNavDate: string): string {
  if (date > latestNavDate) return latestNavDate;
  if (date >= firstNavDate) return date;
  return daysBetween(date, firstNavDate) <= 31 ? date : firstNavDate;
}

function daysBetween(a: string, b: string): number {
  return Math.abs((parseYmd(b).getTime() - parseYmd(a).getTime()) / DAY_MS);
}

function shiftYears(date: string, years: number): string {
  const d = parseYmd(date);
  const year = d.getUTCFullYear() + years, month = d.getUTCMonth();
  return formatYmd(new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDayOfMonth(year, month)))));
}

function parseYmd(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
}

function formatYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
