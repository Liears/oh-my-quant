import type { FundNavDaily } from "../../../types/data.ts";
import type { AkshareFundHistory } from "../../../source/index.ts";

export const NAV_OBSERVED_AT = "2026-04-01T00:00:00.000Z";
export function fundNav(): FundNavDaily[] {
  return [["2026-01-01", 1], ["2026-02-01", 0.5], ["2026-03-01", 0.75]] .map(([date, value]) => ({
    fundCode: "270042", navDate: String(date), unitNav: Number(value), accumulatedNav: Number(value), dailyReturnPct: null, isOpenDay: true, source: "akshare:fund_open_fund_info_em",
  }));
}
export function fundHistory(nav = fundNav(), purchase: Record<string, unknown> = { "手续费": 0.03 }): AkshareFundHistory {
  return { symbol: "270042", fetchedAt: "2026-04-01T08:00:00", nav, purchase, profile: {}, rank: {}, achievement: [], analysis: [],
    attempts: [{ endpoint: "fund_open_fund_info_em:单位净值走势", status: "ok", rows: nav.length }] };
}
