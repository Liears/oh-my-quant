import { describe, expect, it } from "bun:test";
import type { Bar } from "../../types/data.ts";
import type { DailyBarDataset, ResearchContext } from "../../types/research-data.ts";
import { selectCompletedBars } from "../research-data.ts";
import { analyzePriceVolume, atr, closeLocationEfficiency, medianTradedAmount, precedingVolumeRatio, relativeStrength } from "../price-volume.ts";

const dates = ["2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"];
const context: ResearchContext = {
  asOf: "2026-10-13T16:00:00+08:00",
  calendar: { source: "synthetic exchange calendar", verifiedAt: "2026-10-13T15:10:00+08:00",
    lastCompletedSession: dates[3], sessions: dates },
};
const bars: Bar[] = [
  { date: dates[0], open: 10, high: 11, low: 9, close: 10, volume: 100, amount: 1000 },
  { date: dates[1], open: 10, high: 11, low: 9, close: 10, volume: 200, amount: 2000 },
  { date: dates[2], open: 10, high: 14, low: 10, close: 12, volume: 300, amount: 3000 },
  { date: dates[3], open: 12, high: 18, low: 12, close: 15, volume: 1000, amount: 4000 },
];
function dataset(input: Bar[] = bars): DailyBarDataset {
  return { symbol: "600000.SH", market: "A", source: "synthetic provider", fetchedAt: "2026-10-13T15:30:00+08:00",
    marketAt: "2026-10-13T15:00:00+08:00", units: { volume: "shares", amount: "CNY" },
    adjustment: { basis: "qfq", source: "synthetic adjustment record", verifiedAt: "2026-10-13T15:05:00+08:00" },
    finality: Object.fromEntries(input.map((b) => [b.date,
      { status: "final", source: "synthetic source finalization", verifiedAt: `${b.date}T15:10:00+08:00` }])),
    bars: input.map((b) => ({ ...b })) };
}

describe("completed research data contract", () => {
  it("selects dated source-confirmed bars", () => {
    expect(selectCompletedBars(dataset(), context)).toMatchObject({ status: "ready", bars, issues: [], excluded: [] });
  });

  it("excludes today's incomplete bar during the session", () => {
    const d = dataset();
    d.marketAt = "2026-10-13T10:29:00+08:00";
    d.fetchedAt = "2026-10-13T10:30:00+08:00";
    d.adjustment.verifiedAt = "2026-10-12T15:10:00+08:00";
    const c = { asOf: "2026-10-13T10:31:00+08:00", calendar: {
      ...context.calendar, verifiedAt: "2026-10-12T16:00:00+08:00", sessions: dates.slice(0, 3), lastCompletedSession: dates[2] } };
    const r = selectCompletedBars(d, c);
    expect(r.status).toBe("ready");
    expect(r.bars).toHaveLength(3);
    expect(r.excluded).toEqual([{ date: dates[3], reason: "not_completed_session" }]);
  });

  it("does not turn a fetched bar into a final bar", () => {
    for (const status of ["partial", "unknown"] as const) {
      const d = dataset();
      d.finality[dates[3]].status = status;
      const r = selectCompletedBars(d, context);
      expect(r.status).toBe("data_insufficient");
      expect(r.issues).toContain("missing_latest_completed_bar");
      expect(r.excluded[0].reason).toBe("unverified_bar_finality");
    }
  });

  it("refuses unknown adjustment and future source evidence", () => {
    const d = dataset();
    d.adjustment.basis = "unknown";
    expect(selectCompletedBars(d, context).issues).toContain("unverified_adjustment_basis");
    const future = dataset();
    future.finality[dates[3]].verifiedAt = "2026-10-13T17:00:00+08:00";
    expect(selectCompletedBars(future, context).status).toBe("data_insufficient");
    const laterAdjustment = dataset();
    laterAdjustment.adjustment.verifiedAt = "2026-10-13T15:45:00+08:00";
    expect(selectCompletedBars(laterAdjustment, context).issues).toContain("unverified_adjustment_basis");
  });

  it("rejects duplicate sessions, pre-close completion and unsourced calendars", () => {
    for (const calendar of [
      { ...context.calendar, sessions: [...dates, dates[3]] },
      { ...context.calendar, source: "" },
      { ...context.calendar, verifiedAt: "2026-10-13T10:00:00+08:00" },
      { ...context.calendar, sessions: [...dates.slice(0, 3), "2026-02-30"] },
    ]) expect(selectCompletedBars(dataset(), { ...context, calendar }).issues).toContain("invalid_completed_exchange_calendar");
    expect(selectCompletedBars(dataset(), { ...context, asOf: "2026-10-13T14:00:00+08:00" }).status).toBe("data_insufficient");
  });

  it("rejects bad timestamps rather than normalizing them", () => {
    for (const asOf of ["2026-10-13T16:00:00", "2026-10-13T08:00:00Z", "2026-02-30T16:00:00+08:00", "2026-10-13T24:00:00+08:00"]) {
      expect(selectCompletedBars(dataset(), { ...context, asOf }).issues).toContain("invalid_analysis_timestamp");
    }
  });

  it("rejects future underlying market times and duplicate bars", () => {
    const d = dataset();
    d.marketAt = "2026-10-13T15:45:00+08:00";
    expect(selectCompletedBars(d, context).issues).toContain("invalid_underlying_market_timestamp");
    const duplicate = dataset([...bars, bars[3]]);
    expect(selectCompletedBars(duplicate, context).issues).toContain("bars_not_unique_and_ascending");
    const stale = dataset();
    stale.marketAt = "2026-10-12T15:00:00+08:00";
    expect(selectCompletedBars(stale, context).issues).toContain("market_timestamp_precedes_final_bar");
  });

  it("does not apply Shanghai daily-close rules to other markets", () => {
    const d = dataset();
    d.market = "US";
    expect(selectCompletedBars(d, context).issues).toContain("unsupported_research_market");
  });
});

describe("price-volume calculations", () => {
  it("uses true range and distinct SMA/Wilder updates", () => {
    expect(atr(bars, 2, "sma")).toEqual([null, null, 3, 5]);
    expect(atr(bars, 2, "wilder")).toEqual([null, null, 3, 4.5]);
    const gap = [{ ...bars[0] }, { ...bars[1], open: 15, high: 16, low: 14, close: 15 }];
    expect(atr(gap, 1)).toEqual([null, 6]);
  });

  it("does not invent ATR during warm-up", () => {
    expect(atr(bars, 14)).toEqual([null, null, null, null]);
  });

  it("calculates location and leaves zero-range bars unavailable", () => {
    expect(closeLocationEfficiency(bars[3])).toBe(0.5);
    expect(closeLocationEfficiency({ ...bars[0], open: 10, high: 10, low: 10, close: 10 })).toBeNull();
  });

  it("excludes current volume from its median baseline", () => {
    expect(precedingVolumeRatio(bars, 2)).toBe(4);
    expect(medianTradedAmount(bars, 2)).toBe(3500);
    expect(precedingVolumeRatio(bars, 20)).toBeNull();
    expect(medianTradedAmount(bars, 20)).toBeNull();
    expect(precedingVolumeRatio(bars.map((b) => ({ ...b, volume: 0 })), 2)).toBeNull();
  });

  it("computes RS in percentage points on exact aligned sessions", () => {
    const benchmark = dataset(bars.map((b, i) => ({ ...b, open: 10, high: 11, low: 9, close: i === 3 ? 11 : 10 })));
    benchmark.symbol = "000300.SH";
    const r = relativeStrength(dataset(), benchmark, context, 2);
    expect(r.status).toBe("ready");
    expect(r.rsPp).toBeCloseTo(40, 12);
    expect(r).toMatchObject({ start: dates[1], end: dates[3], period: 2, benchmark: "000300.SH" });
  });

  it("does not fill missing sessions or stretch the RS window", () => {
    expect(relativeStrength(dataset(), dataset(bars.filter((b) => b.date !== dates[2])), context, 2).issues)
      .toContain("missing_aligned_sessions");
    expect(relativeStrength(dataset(), dataset(), context, 20).status).toBe("data_insufficient");
    const b = dataset();
    b.adjustment.basis = "raw";
    expect(relativeStrength(dataset(), b, context, 2).issues).toContain("different_adjustment_basis");
  });

  it("provides a dataset-aware summary only with known units and complete windows", () => {
    const r = analyzePriceVolume(dataset(), context, 2, 2);
    expect(r.status).toBe("ready");
    expect(r.metrics).toMatchObject({ atr: 4.5, smoothing: "wilder", precedingVolumeRatio: 4, medianAmount: 3500, amountUnit: "CNY" });
    expect(r.metrics).toMatchObject({ historyStart: dates[0], historyObservations: 4 });
    const d = dataset();
    d.units.amount = "unknown";
    expect(analyzePriceVolume(d, context, 2, 2).metrics).toBeNull();
    const partial = dataset();
    partial.finality[dates[2]].status = "partial";
    expect(analyzePriceVolume(partial, context, 2, 2).issues).toContain("missing_feature_sessions");
  });

  it("rejects invalid prices, negative activity, and non-integer windows", () => {
    expect(() => atr(bars, 0)).toThrow();
    expect(() => precedingVolumeRatio(bars, 1.5)).toThrow();
    expect(() => closeLocationEfficiency({ ...bars[0], close: 0 })).toThrow();
    expect(() => medianTradedAmount([{ ...bars[0], amount: -1 }], 1)).toThrow();
  });
});
