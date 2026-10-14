import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMeta, isCacheFresh, loadArchivedBarsBefore, loadBars, loadCachedBars, loadDataset, saveBars } from "../src/bars.ts";
import type { Bar } from "../../types/data.ts";

let root: string;
let previous: string | undefined;
const bar = (date: string, close: number): Bar => ({ date, open: close, high: close, low: close, close, volume: 10, amount: 100 });

beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "ohq-bars-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR;
  else process.env.OHQUANT_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("daily cache updates", () => {
  it("pins the response endpoint in a revision while the head describes only its latest response", async () => {
    const older = bar("2026-09-10", 10), latest = bar("2026-09-11", 11);
    const first = (await saveBars("000300.SH", "akshare", [older], undefined, undefined, undefined, "index_zh_a_hist"))!;
    const second = (await saveBars("000300.SH", "akshare", [latest], undefined, undefined, undefined, "stock_zh_index_hist_csindex"))!;
    expect(first.providerEndpoint).toBe("index_zh_a_hist");
    expect(second.providerEndpoint).toBe("stock_zh_index_hist_csindex");
    expect((await getMeta("000300.SH", "akshare"))?.lastResponseEndpoint).toBe("stock_zh_index_hist_csindex");
    expect((await loadCachedBars("000300.SH", "akshare")).dataset?.providerEndpoint).toBe("stock_zh_index_hist_csindex");
    expect(await loadBars("000300.SH", "akshare")).toEqual([older, latest]);
    expect(loadDataset(first)).toEqual([older]);
    expect(loadDataset(second)).toEqual([latest]);
    expect(() => loadDataset({ ...second, providerEndpoint: undefined })).toThrow("does not match");
    expect(() => loadDataset({ ...second, providerEndpoint: "index_zh_a_hist" })).toThrow("does not match");
    const forgedOlder = { ...second, dates: [older.date], contentHash: createHash("sha256").update(JSON.stringify([older])).digest("hex") };
    expect(() => loadDataset(forgedOlder)).toThrow("does not match");
    const head = join(root, "data", "akshare", "000300.SH", "snapshot.json");
    const snapshot = JSON.parse(readFileSync(head, "utf8")) as { version: 1; bars: Bar[]; meta: Record<string, unknown> };
    const { fetchedDates: _dates, ...meta } = snapshot.meta;
    const payload = { version: snapshot.version, bars: snapshot.bars, meta };
    writeFileSync(head, JSON.stringify({ ...payload, revision: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }));
    expect(await loadCachedBars("000300.SH", "akshare")).toEqual({ bars: [], fresh: false });
    expect(loadDataset(second)).toEqual([latest]);
  });

  it("keeps endpoint-free revisions readable and rejects unsafe endpoint labels before writing", async () => {
    const old = (await saveBars("AAPL", "financial-datasets", [bar("2026-09-10", 10)]))!;
    expect(old.providerEndpoint).toBeUndefined();
    expect(loadDataset(old)).toHaveLength(1);
    await expect(saveBars("000300.SH", "akshare", [bar("2026-09-11", 11)], undefined, undefined, undefined, "https://example.test?token=secret"))
      .rejects.toThrow("Invalid provider endpoint");
    expect(await getMeta("000300.SH", "akshare")).toBeNull();
  });

  it("replaces corrected dates, preserves history, and canonicalizes bare symbols", async () => {
    await saveBars("600000", "akshare", [bar("2026-09-10", 10), bar("2026-09-11", 11)]);
    await saveBars("600000.SH", "akshare", [bar("2026-09-11", 12), bar("2026-09-12", 13)]);
    expect((await loadBars("600000", "akshare")).map(item => item.close)).toEqual([10, 12, 13]);
    expect(await getMeta("600000", "akshare")).toMatchObject({ symbol: "600000.SH", rowCount: 3, lastDate: "2026-09-12" });
  });

  it("does not lose overlapping concurrent updates", async () => {
    await Promise.all([
      saveBars("AAPL", "financial-datasets", [bar("2026-09-10", 10)]),
      saveBars("AAPL", "financial-datasets", [bar("2026-09-11", 11)]),
    ]);
    expect(await loadBars("AAPL", "financial-datasets")).toHaveLength(2);
    expect(await getMeta("AAPL", "financial-datasets")).toMatchObject({ market: "US" });
  });

  it("round-trips missing turnover in a pinned dataset without changing a reported zero", async () => {
    const missing = { ...bar("2026-09-10", 10), amount: null };
    const zero = { ...bar("2026-09-11", 11), amount: 0 };
    const ref = (await saveBars("AAPL", "financial-datasets", [missing, zero]))!;
    expect(await loadBars("AAPL", "financial-datasets")).toEqual([missing, zero]);
    expect(loadDataset(ref)).toEqual([missing, zero]);
    expect(ref.dates).toEqual([missing.date, zero.date]);
  });

  it("checks requested coverage and expires intraday and future timestamps", async () => {
    await saveBars("AAPL", "financial-datasets", [bar("2026-09-11", 10)], "2026-09-01", "2026-09-13");
    expect(await isCacheFresh("AAPL", "financial-datasets", "2026-09-01", "2026-09-13")).toBe(true);
    expect(await isCacheFresh("AAPL", "financial-datasets", "2025-01-01", "2026-09-13")).toBe(false);
    expect(await isCacheFresh("AAPL", "financial-datasets")).toBe(false);
    const now = Date.now();
    const clock = spyOn(Date, "now");
    try {
      for (const offset of [6 * 60_000, -60_000]) {
        clock.mockReturnValue(now + offset);
        expect(await isCacheFresh("AAPL", "financial-datasets", "2026-09-01", "2026-09-13")).toBe(false);
      }
    } finally { clock.mockRestore(); }
  });

  it("recovers from malformed cache and ignores empty updates", async () => {
    await saveBars("AAPL", "financial-datasets", [bar("2026-09-11", 10)]);
    const path = join(root, "data", "financial-datasets", "AAPL", "snapshot.json");
    for (const value of ["null", "{}", "[null]", "not-json"]) {
      writeFileSync(path, value);
      expect(await loadBars("AAPL", "financial-datasets")).toEqual([]);
    }
    await saveBars("AAPL", "financial-datasets", [bar("2026-09-12", 12)]);
    const meta = await getMeta("AAPL", "financial-datasets");
    await saveBars("AAPL", "financial-datasets", []);
    expect(await getMeta("AAPL", "financial-datasets")).toEqual(meta);
    expect(await loadBars("AAPL", "financial-datasets")).toEqual([bar("2026-09-12", 12)]);
  });

  it("does not refresh the head or change an immutable dataset when the new OHLC response is contradictory", async () => {
    const original = bar("2026-09-11", 10);
    const ref = (await saveBars("AAPL", "financial-datasets", [original]))!;
    const head = join(root, "data", "financial-datasets", "AAPL", "snapshot.json");
    const bytes = readFileSync(head, "utf8"), meta = await getMeta("AAPL", "financial-datasets");
    expect(await saveBars("AAPL", "financial-datasets", [
      { ...bar("2026-09-12", 12), high: 9 }, { ...bar("2026-09-13", 13), low: 14 },
    ])).toBeNull();
    expect(readFileSync(head, "utf8")).toBe(bytes);
    expect(await getMeta("AAPL", "financial-datasets")).toEqual(meta);
    expect(loadDataset(ref)).toEqual([original]);
  });

  it("rejects cache path escapes before filesystem writes", async () => {
    await expect(saveBars("../settings", "akshare", [bar("2026-09-12", 1)])).rejects.toThrow("Invalid market symbol");
    await expect(loadBars("AAPL", "../../other")).rejects.toThrow("Invalid data source");
  });

  it("honors cancellation before cache, archive, and commit filesystem work", async () => {
    const controller = new AbortController();
    controller.abort(new Error("request deadline"));
    await expect(loadCachedBars("AAPL", "akshare", undefined, undefined, controller.signal)).rejects.toThrow("request deadline");
    await expect(loadArchivedBarsBefore(
      "AAPL", "akshare", undefined, undefined, "2026-09-24T00:00:00.000Z", controller.signal,
    )).rejects.toThrow("request deadline");
    await expect(saveBars("AAPL", "akshare", [bar("2026-09-12", 1)], undefined, undefined, controller.signal))
      .rejects.toThrow("request deadline");
    expect(existsSync(join(root, "data"))).toBe(false);
  });
});

it("upstream same-session corrections retain sorted accumulated history", async () => {
    const b: Bar = { date: "2026-10-12", open: 10, high: 11, low: 9, close: 10, volume: 100, amount: 1000 };
    await saveBars("600000.SH", "akshare", [b, { ...b, date: "2026-10-13" }]);
    await saveBars("600000.SH", "akshare", [{ ...b, date: "2026-10-13", close: 11, volume: 200 },
      { ...b, date: "2026-10-09" }, { ...b, date: "2026-10-13", close: 10.5, volume: 300 }]);
    const r = await loadBars("600000.SH", "akshare");
    expect(r.map((bar) => bar.date)).toEqual(["2026-10-09", "2026-10-12", "2026-10-13"]);
    expect(r.at(-1)).toMatchObject({ close: 10.5, volume: 300 });
    expect((await getMeta("600000.SH", "akshare"))?.rowCount).toBe(3);
});
