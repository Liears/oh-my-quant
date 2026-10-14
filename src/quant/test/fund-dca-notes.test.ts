import { expect, test } from "bun:test";
import { runDcaBacktest } from "../fund-dca.ts";
import { fundDcaInterpretationNotes } from "../fund-dca-notes.ts";
import { fundNav } from "../../storage/test/fixtures/fund-nav.ts";

test("explains two purchases and one 28-day interval without confusing principal, TWR or annualized XIRR", () => {
  const result = runDcaBacktest(fundNav(), { startDate: "2026-02-01", endDate: "2026-03-01", investAmount: 100, purchaseFeeRate: 0 });
  const before = JSON.stringify(result), notes = fundDcaInterpretationNotes(result).join("\n");
  expect(notes).toContain("2 NAV valuation dates, 1 adjacent NAV intervals. Purchases: 2 on 2 distinct dates");
  expect(notes).toContain("First contribution: 28 calendar days"); expect(notes).toContain("last contribution: 0 days");
  expect(notes).toContain("First purchase NAV: 0.5 on 2026-02-01; last purchase NAV: 0.75 on 2026-03-01. Blended average unit cost: 0.6");
  expect(notes).toContain("purchase NAVs differ, so blended cost is not the NAV of every trade");
  expect(notes).toContain("Purchases on final valuation date: 1"); expect(notes).toContain("actual days / 365");
  expect(notes).toContain("not the gain on all contributed capital"); expect(notes).toContain("not verified account performance");
  expect(notes).toContain("Verified principal identity: final simulated value / cumulative gross contributions = 1.25");
  expect(notes).toContain("not independent of fund performance");
  expect(notes).toContain("gross-contribution-weighted average");
  expect(notes).toContain("fixed-amount DCA has equal gross contribution weights. Purchase holding durations differ");
  expect(notes).toContain("matching valuation periods, return type, currency and consistent fee/distribution treatment");
  expect(notes).toContain("observed cash-flow span is 28 calendar days");
  expect(notes).toContain("annualization extrapolates hypothetically");
  expect(notes).toContain("a high solved rate is not a calculation error");
  expect(notes).toContain("A-market data route do not establish the fund's underlying asset class");
  expect(result.summary.returnRate).toBeCloseTo(0.25, 12); expect(result.summary.timeWeightedReturn).toBeCloseTo(0.5, 12);
  expect(result.summary.xirr).toBeCloseTo(Math.pow(1.5, 365 / 28) - 1, 7);
  expect(JSON.stringify(result)).toBe(before);
});

test("uses actual delayed purchase dates and distinguishes scheduled purchases sharing a NAV date", () => {
  const result = runDcaBacktest(fundNav().slice(1), { startDate: "2026-01-01", endDate: "2026-03-01", investAmount: 100, purchaseFeeRate: 0.01, purchaseFeeUnit: "decimal" });
  const notes = fundDcaInterpretationNotes(result).join("\n");
  expect(result.trades.map(trade => trade.tradeDate)).toEqual(["2026-02-01", "2026-02-01", "2026-03-01"]);
  expect(notes).toContain("Observed holding window: 2026-02-01 — 2026-03-01");
  expect(notes).toContain("Purchases: 3 on 2 distinct dates"); expect(notes).toContain("purchase fees still apply");
  expect(notes).toContain("First purchase NAV: 0.5 on 2026-02-01; last purchase NAV: 0.75 on 2026-03-01");
  expect(result.accountCurve[0]!.performanceIndex).toBeLessThan(1);
});

test("single-date observations preserve unsolved XIRR and never imply a holding interval or zero risk", () => {
  const result = runDcaBacktest(fundNav(), { startDate: "2026-03-01", endDate: "2026-03-01", investAmount: 123.45 });
  const notes = fundDcaInterpretationNotes(result).join("\n");
  expect(notes).toContain("1 NAV valuation dates, 0 adjacent NAV intervals");
  expect(notes).toContain("First contribution: 0 calendar days"); expect(notes).toContain("N/A means no dated money-weighted rate was solved, not zero return");
  expect(notes).not.toContain("a high solved rate is not a calculation error");
  expect(notes).toContain("All purchases share the same observed NAV date and holding duration.");
  expect(notes).toContain("all observed purchases use the same NAV");
  expect(notes).not.toContain("Contributions have different holding durations");
  expect(notes).toContain("Observed purchases share the same holding duration");
  expect(notes).not.toContain("Purchase holding durations differ");
  expect(notes).toContain("zero observed drawdown does not mean no risk"); expect(notes).not.toContain("123.45");
  expect(result.summary.xirr).toBeNull();
});
