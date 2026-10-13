import { describe, expect, it } from "bun:test";
import { fetchResearchBars } from "../index.ts";
import { analyzePriceVolume, relativeStrength } from "../../quant/index.ts";
import type { Bar } from "../../types/data.ts";

const bar: Bar = { date: "2026-10-12", open: 10, high: 11, low: 9, close: 10, volume: 100, amount: 1000 };
const now = () => new Date("2026-10-13T16:00:00+08:00");

describe("research source dataset", () => {
  it("connects the public source and quant APIs with an atomic completed-bar snapshot", async () => {
    const dates = ["2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"];
    const prices = [10, 10, 12, 15];
    const context = { asOf: "2026-10-13T16:01:00+08:00", calendar: {
      sessions: dates, lastCompletedSession: dates[3], source: "synthetic calendar",
      verifiedAt: "2026-10-13T15:10:00+08:00",
    } };
    const r = await fetchResearchBars("600000", "A", undefined, undefined, "akshare", {
      adapters: { akshare: {
        fetchBars: async () => { throw new Error("must use snapshot"); },
        fetchDataset: async () => ({
          bars: dates.map((date, i) => ({ ...bar, date, open: prices[i], high: prices[i] + 1,
            low: prices[i] - 1, close: prices[i] })),
          marketAt: "2026-10-13T15:00:00+08:00",
          adjustment: { basis: "qfq", source: "synthetic adjustment", verifiedAt: "2026-10-13T15:05:00+08:00" },
          units: { volume: "shares", amount: "CNY" },
          finality: Object.fromEntries(dates.map((date) => [date,
            { status: "final" as const, source: "synthetic completed bar", verifiedAt: `${date}T15:05:00+08:00` }])),
        }),
      } },
    }, now);
    expect(r.dataset).not.toBeNull();
    const d = r.dataset!;
    const pv = analyzePriceVolume(d, context, 2, 2);
    expect(pv.status).toBe("ready");
    expect(pv.metrics).toMatchObject({ atr: 3.25, closeLocationEfficiency: 0.5,
      precedingVolumeRatio: 1, medianAmount: 1000, amountUnit: "CNY" });
    const benchmark = { ...d, symbol: "000300.SH", bars: d.bars.map((b) => ({ ...b, open: 10, high: 11, low: 9, close: 10 })) };
    expect(relativeStrength(d, benchmark, context, 2).rsPp).toBeCloseTo(50, 12);
    expect(relativeStrength(d, benchmark, context, 5).status).toBe("data_insufficient");
  });

  it("keeps legacy adapter evidence unknown without changing underlying time", async () => {
    const r = await fetchResearchBars("600000", "A", undefined, undefined, "akshare", {
      adapters: { akshare: { fetchBars: async () => [bar] } },
    }, now);
    expect(r.dataset).toMatchObject({ symbol: "600000.SH", source: "akshare", fetchedAt: now().toISOString(),
      marketAt: null, adjustment: { basis: "unknown" }, finality: {}, units: { amount: "unknown", volume: "unknown" } });
  });

  it("receives data and provenance atomically from an evidence-aware adapter", async () => {
    const r = await fetchResearchBars("600000", "A", undefined, undefined, "akshare", {
      adapters: { akshare: { fetchBars: async () => { throw new Error("must use atomic snapshot"); },
        fetchDataset: async () => ({ bars: [bar], marketAt: "2026-10-12T15:00:00+08:00",
          adjustment: { basis: "qfq", source: "fixture", verifiedAt: "2026-10-12T16:00:00+08:00" },
          finality: { [bar.date]: { status: "final", source: "fixture", verifiedAt: "2026-10-12T16:00:00+08:00" } },
          units: { volume: "shares", amount: "CNY" } }) } },
    }, now);
    expect(r.dataset?.marketAt).toBe("2026-10-12T15:00:00+08:00");
    expect(r.dataset?.adjustment.basis).toBe("qfq");
    expect(r.dataset?.finality[bar.date].status).toBe("final");
  });

  it("preserves fallback attribution and never falls back to cache", async () => {
    const r = await fetchResearchBars("600000", "A", undefined, undefined, "akshare", {
      adapters: { akshare: { fetchBars: async () => { throw new Error("token=secret"); } },
        tushare: { fetchBars: async () => [bar] } },
    }, now);
    expect(r.dataset?.source).toBe("tushare");
    expect(r.attempts[0].error).not.toContain("secret");
    const empty = await fetchResearchBars("600000", "A", undefined, undefined, "akshare", {
      adapters: { akshare: { fetchBars: async () => [] }, tushare: { fetchBars: async () => [] } },
    }, now);
    expect(empty.dataset).toBeNull();
  });
});
