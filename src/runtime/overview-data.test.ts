import { expect, it } from "bun:test";
import { setImmediate } from "node:timers/promises";
import { OverviewRequestPool, fetchOverviewHoldings, fetchOverviewQuotes } from "./overview-data.ts";
import type { OverviewPullMeta } from "./overview-data.ts";
import type { LiveBarsFetchResult } from "../source/index.ts";

function quotes(): LiveBarsFetchResult {
  return { source: "akshare", asOfDate: "2026-09-11", window: "requested", attempts: [{ source: "akshare", status: "success" }],
    bars: [100, 105].map((close, i) => ({ date: `2026-09-${10 + i}`, open: close, high: close, low: close, close, volume: 1, amount: close })) };
}

it("shares canonical symbols across market and portfolio while bounding actual active calls", async () => {
  const releases: Array<() => void> = [], seen: string[] = [];
  let active = 0, peak = 0;
  const pool = new OverviewRequestPool({ concurrency: 3, fetcher: async symbol => {
    seen.push(symbol); active++; peak = Math.max(peak, active);
    await new Promise<void>(resolve => releases.push(resolve));
    active--; return quotes();
  } });
  const meta: OverviewPullMeta = { sources: [], asOfDates: [], pool };
  const entries = Array.from({ length: 20 }, (_, i) => ({ code: `SYNTH${i}`, name: `合成 ${i}` }));
  try {
    const market = fetchOverviewQuotes(entries, meta);
    const portfolio = fetchOverviewHoldings([{ code: "synth0", name: "Same security" }, { code: "SYNTH1", name: "Alias" }], meta);
    expect(seen).toHaveLength(3);
    for (let round = 0; round < 8; round++) { releases.splice(0).forEach(release => release()); await setImmediate(); }
    const [marketRows, portfolioRows] = await Promise.all([market, portfolio]);
    expect(peak).toBe(3); expect(seen).toHaveLength(20); expect(new Set(seen).size).toBe(20);
    expect(marketRows.map(row => row.code)).toEqual(entries.map(entry => entry.code));
    expect(portfolioRows[0]).toMatchObject({ code: "synth0", name: "Same security", observation: { symbol: "SYNTH0", state: "available" } });
    expect(portfolioRows[0]!.pct).toBeCloseTo(5, 10);
    expect(pool.timings()).toHaveLength(20);
    expect(pool.timings().every(timing => timing.queueMs >= 0 && timing.fetchMs !== null && timing.outcome === "success")).toBe(true);
  } finally { pool.close(); }
});

it("keeps stocks, exchange indices and open funds distinct while deduplicating aliases", async () => {
  const seen: string[] = [];
  const pool = new OverviewRequestPool({ fetcher: async symbol => { seen.push(symbol); return quotes(); } });
  try {
    await Promise.all([
      pool.fetch({ code: "000001", name: "stock" }), pool.fetch({ code: "000001.SZ", name: "stock alias" }),
      pool.fetch({ code: "000001.SH", name: "index" }), pool.fetch({ code: "022364", name: "fund", instrument: "fund" }),
      pool.fetch({ code: "022364.OF", name: "fund alias" }),
    ]);
    expect(seen).toEqual(["000001.SZ", "000001.SH", "022364.OF"]);
  } finally { pool.close(); }
});

it("cancels queued and uncooperative in-flight requests without starting the remaining queue", async () => {
  const controller = new AbortController(), releases: Array<(value: LiveBarsFetchResult) => void> = [];
  let calls = 0;
  const pool = new OverviewRequestPool({ signal: controller.signal, concurrency: 2, fetcher: async () => {
    calls++; return new Promise(resolve => releases.push(resolve));
  } });
  const pending = Promise.allSettled(Array.from({ length: 12 }, (_, i) => pool.fetch({ code: `SYM${i}`, name: "fixture" })));
  controller.abort(new Error("cancel fixture"));
  expect((await pending).every(result => result.status === "rejected")).toBe(true);
  expect(calls).toBe(2);
  const timings = pool.timings();
  expect(timings).toHaveLength(12);
  expect(timings.filter(timing => timing.fetchMs === null)).toHaveLength(10);
  expect(timings.every(timing => timing.outcome === "cancelled")).toBe(true);
  releases.forEach(release => release(quotes())); await setImmediate();
  expect(calls).toBe(2); expect(pool.timings()).toEqual(timings);
  pool.close();
});

it("makes unrestricted window fallback and unavailable quotes explicit without swallowing cancellation", async () => {
  const controller = new AbortController();
  const pool = new OverviewRequestPool({ signal: controller.signal, fetcher: async symbol => symbol === "AAPL"
    ? { ...quotes(), window: "latest-available", attempts: [{ source: "tushare", status: "error" }, { source: "akshare", status: "success" }] }
    : { bars: [], source: "unavailable", asOfDate: "", window: "unavailable", attempts: [] } });
  const meta: OverviewPullMeta = { sources: [], asOfDates: [], signal: controller.signal, pool };
  try {
    const rows = await fetchOverviewHoldings([{ code: "AAPL", name: "old data" }, { code: "MSFT", name: "missing" }], meta);
    expect(rows[0]?.observation).toMatchObject({ state: "outside-window", fallback: true, asOfDate: "2026-09-11" });
    expect(rows[1]?.observation).toMatchObject({ state: "unavailable", source: "unavailable", asOfDate: null });
    expect(Number.isNaN(rows[1]!.pct)).toBe(true);
    controller.abort(new Error("stop quotes"));
    await expect(fetchOverviewHoldings([{ code: "AAPL", name: "cancelled" }], meta)).rejects.toThrow("stop quotes");
  } finally { pool.close(); }
});
