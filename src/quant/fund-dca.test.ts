import { describe, expect, it } from "bun:test";
import type { FundNavDaily } from "../types/data.ts";
import { buildDcaSchedule, calculateXirr, runDcaBacktest } from "./fund-dca.ts";

describe("fund DCA backtest", () => {
  it("aligns scheduled buys to the next available NAV date", () => {
    const result = runDcaBacktest(sampleNav(), {
      startDate: "2020-01-01",
      endDate: "2020-03-31",
      frequency: "monthly",
      investAmount: 1000,
      investDay: 1,
      purchaseFeeRate: 0,
    });

    expect(result.trades.map((trade) => [trade.scheduledDate, trade.tradeDate])).toEqual([
      ["2020-01-01", "2020-01-02"],
      ["2020-02-01", "2020-02-03"],
      ["2020-03-01", "2020-03-02"],
    ]);
    expect(result.summary.tradeCount).toBe(3);
    expect(result.summary.totalPrincipal).toBe(3000);
    expect(result.summary.finalMarketValue).toBeCloseTo((1000 / 1 + 1000 / 1.1 + 1000 / 1.2) * 1.3, 6);
    expect(result.summary.returnRate).toBeGreaterThan(0);
    expect(result.summary.xirr).toBeGreaterThan(0);
  });

  it("normalizes percent-like fee input and records purchase fee", () => {
    const result = runDcaBacktest(sampleNav().slice(0, 2), {
      startDate: "2020-01-01",
      endDate: "2020-01-02",
      investAmount: 1000,
      purchaseFeeRate: 0.13,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.purchaseFee).toBeGreaterThan(1);
    expect(result.trades[0]!.purchaseFee).toBeLessThan(2);
  });

  it("builds weekly and quarterly schedules", () => {
    expect(buildDcaSchedule("2020-01-01", "2020-01-20", "weekly", 1)).toEqual([
      "2020-01-06",
      "2020-01-13",
      "2020-01-20",
    ]);
    expect(buildDcaSchedule("2020-01-01", "2020-07-31", "quarterly", 31)).toEqual([
      "2020-01-31",
      "2020-04-30",
      "2020-07-31",
    ]);
  });

  it("returns null XIRR when cashflows cannot be solved", () => {
    expect(calculateXirr([{ date: "2020-01-01", amount: -1000 }])).toBeNull();
    expect(calculateXirr([{ date: "2020-01-01", amount: -1000 }, { date: "2020-01-01", amount: 1000 }])).toBeNull();
    expect(calculateXirr([{ date: "2020-02-30", amount: -1000 }, { date: "2021-01-01", amount: 1100 }])).toBeNull();
    expect(calculateXirr([{ date: "2020-01-01", amount: -Infinity }, { date: "2021-01-01", amount: 1100 }])).toBeNull();
  });

  it("matches an independent dated-cashflow example and preserves XIRR across investment scales", () => {
    // Microsoft XIRR example: https://support.microsoft.com/en-us/excel/functions/xirr-function
    const flows = [{ date: "2008-01-01", amount: -10000 }, { date: "2008-03-01", amount: 2750 },
      { date: "2008-10-30", amount: 4250 }, { date: "2009-02-15", amount: 3250 }, { date: "2009-04-01", amount: 2750 }];
    for (const scale of [1e-12, 1, 1e12]) expect(calculateXirr(flows.map(flow => ({ ...flow, amount: flow.amount * scale })))).toBeCloseTo(0.373362535, 8);
    // Exactly 365 days: terminal / initial - 1, outside the old [-.9999, 10] bracket.
    expect(calculateXirr([{ date: "2025-01-01", amount: -100 }, { date: "2026-01-01", amount: 2000 }])).toBeCloseTo(19, 10);
    expect(calculateXirr([{ date: "2025-01-01", amount: -100 }, { date: "2026-01-01", amount: 0.00001 }])).toBeCloseTo(-0.9999999, 12);
  });

  it("anchors the default window to the requested end and never buys outside it", () => {
    const result = runDcaBacktest([nav("2015-01-01", 1), nav("2020-01-01", 1), nav("2026-01-01", 1)], { endDate: "2020-01-01" });
    expect(result.plan).toMatchObject({ startDate: "2015-01-01", endDate: "2020-01-01" });
    expect(result.trades.every(trade => trade.tradeDate <= "2020-01-01")).toBe(true);
    expect(result.accountCurve.at(-1)!.date).toBe("2020-01-01");
    const leap = runDcaBacktest([nav("2019-02-28", 1), nav("2024-02-29", 1)], { investDay: 28 });
    expect(leap.plan.startDate).toBe("2019-02-28");
  });

  it("rejects invalid, empty and non-overlapping inputs and keeps explicit fee units distinct", () => {
    for (const rows of [[], [nav("2026-02-30", 1)], [nav("2026-01-01", 0)], [nav("2026-01-01", 1), nav("2026-01-01", 2)]]) {
      expect(() => runDcaBacktest(rows)).toThrow();
    }
    for (const options of [{ startDate: "2021-01-01" }, { endDate: "2019-01-01" }, { startDate: "2020-03-30", investDay: 1 }, { purchaseFeeRate: NaN }, { investAmount: Infinity }, { investDay: 32 }]) {
      expect(() => runDcaBacktest(sampleNav(), options)).toThrow();
    }
    const rows = [nav("2026-01-01", 1)];
    expect(runDcaBacktest(rows, { purchaseFeeRate: 0.13, purchaseFeeUnit: "decimal" }).plan.purchaseFeeRate).toBe(0.13);
    expect(runDcaBacktest(rows, { purchaseFeeRate: 0.13, purchaseFeeUnit: "percent" }).plan.purchaseFeeRate).toBe(0.0013);
  });

  it("does not hide a NAV loss behind a new contribution", () => {
    const result = runDcaBacktest([nav("2026-01-01", 1), nav("2026-02-01", 0.5), nav("2026-03-01", 0.75)], { startDate: "2026-01-01", investAmount: 1000 });
    // Gross account values are 1000, 1500, 3250; investment performance is 1, .5, .75.
    expect(result.accountCurve.map(point => point.marketValue)).toEqual([1000, 1500, 3250]);
    expect(result.summary.maxDrawdown).toBe(-0.5);
    expect(result.summary.returnRate).toBeCloseTo(250 / 3000, 12);
  });

  it("charges fees in the unit performance sequence without counting new capital as return", () => {
    const result = runDcaBacktest([nav("2026-01-01", 1), nav("2026-02-01", 1)], { startDate: "2026-01-01", investAmount: 1010, purchaseFeeRate: 0.01 });
    // 1010 buys 1000 net, twice. First factor = 1000/1010; next = 2000/2010.
    expect(result.summary.maxDrawdown).toBeCloseTo((1000 / 1010) * (2000 / 2010) - 1, 12);
    expect(result.summary.totalPurchaseFee).toBeCloseTo(20, 12);
  });
});

function sampleNav(): FundNavDaily[] {
  return [
    nav("2020-01-02", 1),
    nav("2020-01-15", 0.9),
    nav("2020-02-03", 1.1),
    nav("2020-03-02", 1.2),
    nav("2020-03-31", 1.3),
  ];
}

function nav(navDate: string, unitNav: number): FundNavDaily {
  return {
    fundCode: "270042",
    navDate,
    unitNav,
    accumulatedNav: unitNav,
    dailyReturnPct: null,
    isOpenDay: true,
    source: "test",
  };
}
