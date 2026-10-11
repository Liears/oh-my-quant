import { expect, it } from "bun:test";
import type { ResearchBarsDataset, ResearchFundDataset } from "../../research/types.ts";
import { instrumentLookupUrls } from "../src/source-links.ts";

function bars(symbol: string, providerEndpoint?: string): ResearchBarsDataset {
  return { ref: { version: 1, kind: "daily-bars", symbol, market: "A", source: "akshare",
    revision: "a".repeat(64), contentHash: "b".repeat(64), dates: ["2026-09-18"],
    requested: { start: "2026-09-18", end: "2026-09-18" }, snapshotAt: "2026-09-18T00:00:00.000Z",
    adjustment: "provider-unspecified", availability: "observed-at-fetch", providerEndpoint }, bars: [] };
}

function fund(symbol: string): ResearchFundDataset {
  return { ref: { version: 1, kind: "fund-nav", symbol, market: "A", source: "akshare", endpoint: "fund_open_fund_info_em",
    revision: "c".repeat(64), contentHash: "d".repeat(64), dates: ["2026-09-18"],
    requested: { start: "2026-09-18", end: "2026-09-18" }, snapshotAt: "2026-09-18T00:00:00.000Z",
    adjustment: "unit-nav-unadjusted", availability: "observed-at-fetch" }, nav: [], fee: null };
}

it("uses verified instrument type for colliding stock, fund and index codes", () => {
  const stock = bars("000001.SZ", "stock_zh_a_daily");
  const links = instrumentLookupUrls([stock, bars("600519.SH", "stock_zh_a_daily"),
    bars("000300.SH", "stock_zh_index_daily"), stock]);
  expect(links).toEqual([
    { label: "雪球 · 000001.SZ", url: "https://xueqiu.com/S/SZ000001" },
    { label: "同花顺 · 000001.SZ", url: "https://stockpage.10jqka.com.cn/000001/" },
    { label: "雪球 · 600519.SH", url: "https://xueqiu.com/S/SH600519" },
    { label: "同花顺 · 600519.SH", url: "https://stockpage.10jqka.com.cn/600519/" },
  ]);
  expect(links.some(link => link.url.includes("funding/000001"))).toBe(false);
  expect(instrumentLookupUrls([fund("000001.OF")])).toEqual([
    { label: "雪球 · 000001.OF", url: "https://danjuanfunds.com/funding/000001" },
    { label: "同花顺 · 000001.OF", url: "https://fund.10jqka.com.cn/000001/" },
  ]);
});

it("omits an A-market suffix without verified stock endpoint or fund NAV identity", () => {
  expect(instrumentLookupUrls([bars("000001.SZ"), bars("510300.SH", "fund_etf_fund_info_em"),
    bars("000300.SH", "stock_zh_index_daily")])).toEqual([]);
});
