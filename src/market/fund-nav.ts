import { isDailyDate, validateDateRange } from "./bars.ts";
import type { FundNavDaily } from "../types/data.ts";
import { FUND_NAV_ENDPOINTS } from "../types/fund-data.ts";
import type { FundFeeObservation, FundNavDatasetRef } from "../types/fund-data.ts";

export function normalizeFundSymbol(value: string): string {
  if (typeof value !== "string" || !/^\d{6}(?:\.OF)?$/i.test(value.trim())) throw new Error("Fund symbol must be six digits or end in .OF.");
  return `${value.trim().slice(0, 6)}.OF`;
}

/** Canonical public rows only; invalid/mismatched observations do not become valid input. */
export function normalizeFundNav(symbol: string, rows: unknown): FundNavDaily[] {
  const code = normalizeFundSymbol(symbol).slice(0, 6);
  const byDate = new Map<string, FundNavDaily>();
  if (!Array.isArray(rows)) return [];
  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    if (row.fundCode !== code && row.fundCode !== `${code}.OF`) continue;
    if (typeof row.navDate !== "string" || !isDailyDate(row.navDate) || typeof row.unitNav !== "number" || !Number.isFinite(row.unitNav) || row.unitNav <= 0) continue;
    byDate.set(row.navDate, {
      fundCode: code, navDate: row.navDate, unitNav: row.unitNav,
      accumulatedNav: typeof row.accumulatedNav === "number" && Number.isFinite(row.accumulatedNav) && row.accumulatedNav > 0 ? row.accumulatedNav : null,
      dailyReturnPct: typeof row.dailyReturnPct === "number" && Number.isFinite(row.dailyReturnPct) ? row.dailyReturnPct : null,
      isOpenDay: row.isOpenDay === true, source: "akshare",
    });
  }
  return [...byDate.values()].sort((a, b) => a.navDate.localeCompare(b.navDate));
}

export function publicFundFee(value: unknown): FundFeeObservation | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new Error("Invalid fund fee observation.");
  const row = value as Record<string, unknown>;
  if (row.source !== "fund_purchase_em" || typeof row.fetchedAt !== "string" || !isObservationTime(row.fetchedAt)
    || (row.rate !== null && (typeof row.rate !== "number" || !Number.isFinite(row.rate) || row.rate < 0 || row.rate >= 1))) throw new Error("Invalid fund fee observation.");
  return { source: "fund_purchase_em", fetchedAt: row.fetchedAt, rate: row.rate as number | null };
}

export function isObservationTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && isDailyDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

export function publicFundNavRef(value: unknown): FundNavDatasetRef {
  if (!value || typeof value !== "object") throw new Error("Invalid fund NAV reference.");
  const ref = value as FundNavDatasetRef;
  if (ref.version !== 1 || ref.kind !== "fund-nav" || ref.symbol !== normalizeFundSymbol(ref.symbol)
    || ref.market !== "A" || ref.source !== "akshare" || !FUND_NAV_ENDPOINTS.includes(ref.endpoint)
    || typeof ref.revision !== "string" || !/^[a-f0-9]{64}$/.test(ref.revision)
    || typeof ref.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(ref.contentHash)
    || !Array.isArray(ref.dates) || !ref.dates.length || ref.dates.some((date, i) => typeof date !== "string" || !isDailyDate(date) || (i > 0 && date <= ref.dates[i - 1]!))
    || !ref.requested || (ref.requested.start !== null && typeof ref.requested.start !== "string") || (ref.requested.end !== null && typeof ref.requested.end !== "string")
    || typeof ref.snapshotAt !== "string" || !isObservationTime(ref.snapshotAt)
    || ref.adjustment !== "unit-nav-unadjusted" || ref.availability !== "observed-at-fetch") throw new Error("Invalid fund NAV reference.");
  validateDateRange(ref.requested.start ?? undefined, ref.requested.end ?? undefined);
  if (ref.dates.some(date => (ref.requested.start !== null && date < ref.requested.start) || (ref.requested.end !== null && date > ref.requested.end))) throw new Error("Fund NAV dates outside requested window.");
  return { version: 1, kind: "fund-nav", symbol: ref.symbol, market: "A", source: "akshare", endpoint: ref.endpoint,
    revision: ref.revision, contentHash: ref.contentHash, dates: [...ref.dates], requested: { start: ref.requested.start, end: ref.requested.end },
    snapshotAt: ref.snapshotAt, adjustment: "unit-nav-unadjusted", availability: "observed-at-fetch" };
}
