import { describe, expect, it } from "bun:test";
import { buildOverviewPanelSections, collectOverviewSymbols, MARKET_INDICES } from "./overview.ts";

describe("runtime overview service", () => {
  it("builds grouped portfolio, market, and source sections from overview rows", () => {
    const portfolio = {
      symbols: [{ code: "510300.SH", name: "沪深300ETF" }],
      groups: [{ id: "group-1", name: "核心组合", symbolCodes: ["510300.SH"] }],
    };
    const portfolioSymbols = collectOverviewSymbols(portfolio);
    const sections = buildOverviewPanelSections({
      portfolio,
      portfolioSymbols,
      marketQuotes: [{ code: "000001", name: "上证指数", price: 3000, pct: 1 }],
      portfolioRows: [],
      pullMeta: { sources: ["akshare"], asOfDates: ["2026-06-30"] },
      refreshedAt: new Date("2026-06-30T08:30:00.000Z"),
    });

    expect(MARKET_INDICES.map((entry) => entry.code)).toEqual(["000001.SH", "399001.SZ", "000300.SH", "000905.SH", "399006.SZ"]);
    expect(portfolioSymbols.map((entry) => entry.code)).toEqual(["510300.SH", "510300"]);
    expect(sections[0]).toEqual({
      kind: "group",
      groupId: "group-1",
      title: "核心组合",
      rows: [{ code: "510300", name: "沪深300ETF", price: 0, pct: 0 }],
      collapsed: false,
    });
    expect(sections.some((section) => section.title === "Market")).toBe(true);
    expect(sections.at(-1)).toMatchObject({
      kind: "keyvalue",
      title: "Source",
      rows: expect.arrayContaining([{ label: "数据", value: "2026-06-30" }]),
    });
  });
});
