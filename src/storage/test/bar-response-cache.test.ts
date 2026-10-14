import { afterEach, beforeEach, expect, test, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { loadBars, loadCachedBars, loadDataset, readBarsSnapshot, saveBars } from "../src/bars.ts";
import { fetchBars } from "../../source/src/sources.ts";
import type { SourceFetchOptions } from "../../source/src/source-contracts.ts";
import type { Bar, BarsSnapshot } from "../../types/data.ts";
import { createPriceAnalysisTools } from "../../tools/quant-tools.ts";
import { verifyResearchAnalysis } from "../../research/analysis.ts";

let root: string, previous: string | undefined;
const restores: Array<() => void> = [];
const source = "financial-datasets", start = "2026-01-01", end = "2026-01-03";
const bar = (date: string, close: number): Bar => ({ date, open: close, high: close, low: close, close, volume: 10, amount: 100 });
const original = [bar(start, 100), bar("2026-01-02", 50), bar(end, 120)];
const latest = [bar(start, 110), bar(end, 121)];
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-response-cache-")); process.env.OHQUANT_DIR = root;
  const network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected external fetch"));
  restores.push(() => { expect(network).not.toHaveBeenCalled(); network.mockRestore(); });
});
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected response-cache fixture");
  rmSync(root, { recursive: true, force: true });
});

test("provider refresh and immediate cache hit use identical dates and values without resurrecting merged history", async () => {
  const old = (await saveBars("AAPL", source, original, start, end))!;
  const archive = join(root, "data", source, "AAPL", "revisions", `${old.revision}.json`), oldBytes = readFileSync(archive, "utf8");
  let calls = 0;
  const options: SourceFetchOptions = { deps: { loadCache: loadCachedBars, saveBars, getPreferredSource: () => source },
    providers: { adapters: { [source]: { fetchBars: async () => { calls++; return latest; } } } } };
  const refreshed = await fetchBars("AAPL", "US", start, end, source, options);
  const cached = await fetchBars("AAPL", "US", start, end, "auto", options);
  expect(refreshed.origin).toBe("provider"); expect(cached.origin).toBe("cache"); expect(calls).toBe(1);
  expect(cached.bars).toEqual(latest); expect(cached.dataset).toEqual(refreshed.dataset);
  expect(loadDataset(cached.dataset!)).toEqual(latest); expect(loadDataset(old)).toEqual(original);
  expect(readFileSync(archive, "utf8")).toBe(oldBytes);
  expect((await loadBars("AAPL", source)).map(row => row.close)).toEqual([110, 50, 121]);
  const tools = createPriceAnalysisTools((symbol, _minimum, from, until, signal) => fetchBars(symbol, "US", from, until, "auto", { ...options, providers: { ...options.providers, signal } }));
  const args = { symbol: "AAPL", factor: "momentum" as const, period: 1, start, end };
  const factor = await tools.computeFactorTool.execute("cached-factor", args);
  const analysis = verifyResearchAnalysis("compute_factor", args, factor.details as Record<string, unknown>, { input: 0 }, [{ ref: cached.dataset!, bars: loadDataset(cached.dataset!) }]);
  expect(analysis.metrics.find(metric => metric.label === "Latest")?.value).toBeCloseTo(0.1, 12); // 121/110-1, never 121/50-1.
  expect(calls).toBe(1);
});

test("AKShare endpoint provenance survives provider refresh, cache hit, and offline fallback", async () => {
  const symbol = "000300.SH", endpoint = "stock_zh_index_hist_csindex";
  let calls = 0;
  const options: SourceFetchOptions = {
    deps: { loadCache: loadCachedBars, saveBars, getPreferredSource: () => "akshare" },
    providers: { adapters: {
      akshare: { fetchBars: async () => { calls++; return { bars: latest, endpoint }; } },
      tushare: { fetchBars: async () => [] },
    } },
  };
  const refreshed = await fetchBars(symbol, "A", start, end, "akshare", options);
  const cached = await fetchBars(symbol, "A", start, end, "auto", options);
  expect(refreshed.providerEndpoint).toBe(endpoint);
  expect(refreshed.dataset?.providerEndpoint).toBe(endpoint);
  expect(cached.providerEndpoint).toBe(endpoint);
  expect(cached.dataset).toEqual(refreshed.dataset);
  expect(loadDataset(refreshed.dataset!)).toEqual(latest);
  expect(calls).toBe(1);
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 360_000); restores.push(() => clock.mockRestore());
  const offline = await fetchBars(symbol, "A", start, end, "auto", {
    ...options, providers: { adapters: {
      akshare: { fetchBars: async () => { throw new Error("offline fixture"); } },
      tushare: { fetchBars: async () => [] },
    } },
  });
  expect(offline.origin).toBe("stale-cache");
  expect(offline.providerEndpoint).toBe(endpoint);
  expect(offline.dataset).toEqual(refreshed.dataset);
});

test("an expired response stays coherent during offline fallback instead of filling missing dates from old pulls", async () => {
  await saveBars("AAPL", source, original, start, end); await saveBars("AAPL", source, latest, start, end);
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 360_000); restores.push(() => clock.mockRestore());
  const result = await fetchBars("AAPL", "US", start, end, "auto", {
    deps: { loadCache: loadCachedBars, saveBars, getPreferredSource: () => source },
    providers: { fallbackOrder: { US: [source] }, adapters: { [source]: { fetchBars: async () => { throw new Error("offline fixture"); } } } },
  });
  expect(result.origin).toBe("stale-cache"); expect(result.attempts[0]?.status).toBe("error");
  expect(result.bars).toEqual(latest); expect(loadDataset(result.dataset!)).toEqual(latest);
});

test("narrow refreshes retain merged history but do not expose its untouched rows as the newest response", async () => {
  await saveBars("AAPL", source, original, start, end);
  await saveBars("AAPL", source, [bar(end, 130)], end, end);
  expect(await loadCachedBars("AAPL", source, start, "2026-01-02")).toEqual({ bars: [], fresh: false });
  const wide = await loadCachedBars("AAPL", source, start, end);
  expect(wide.fresh).toBe(false); expect(wide.bars).toEqual([bar(end, 130)]);
  expect(loadDataset(wide.dataset!)).toEqual(wide.bars);
  expect((await loadBars("AAPL", source)).map(row => row.close)).toEqual([100, 50, 130]);
});

test("an unbounded response does not claim freshness beyond its actual first or last observation", async () => {
  await saveBars("AAPL", source, original);
  const earlier = await loadCachedBars("AAPL", source, "2025-12-31", end);
  const later = await loadCachedBars("AAPL", source, start, "2026-01-04");
  expect(earlier.fresh).toBe(false);
  expect(later.fresh).toBe(false);
  expect(earlier.bars).toEqual(original);
  expect(later.bars).toEqual(original);
  let calls = 0;
  const result = await fetchBars("AAPL", "US", "2025-12-31", end, "auto", {
    deps: { loadCache: loadCachedBars, saveBars, getPreferredSource: () => source },
    providers: { fallbackOrder: { US: [source] }, adapters: { [source]: { fetchBars: async () => {
      calls++;
      return [bar("2025-12-31", 90), ...original];
    } } } },
  });
  expect(calls).toBe(1);
  expect(result).toMatchObject({ origin: "provider", bars: [bar("2025-12-31", 90), ...original] });
});

test.each([[undefined, undefined], [start, undefined], [undefined, end], [start, end]] as const)("filters the actual response for optional bounds %s / %s", async (from, until) => {
  await saveBars("AAPL", source, original);
  const fresh = await saveBars("AAPL", source, latest, from, until);
  const cache = await loadCachedBars("AAPL", source, from, until);
  expect(cache.fresh).toBe(true); expect(cache.bars).toEqual(latest); expect(cache.dataset).toEqual(fresh!);
  const subset = await loadCachedBars("AAPL", source, end, end);
  expect(subset.fresh).toBe(true); expect(subset.bars).toEqual([latest[1]!]);
});

test("old immutable revisions still resolve but heads without response membership cannot claim freshness", async () => {
  const ref = (await saveBars("AAPL", source, original, start, end))!;
  const snapshot = readBarsSnapshot("AAPL", source)!;
  const meta: Record<string, unknown> = { ...snapshot.meta }; delete meta.fetchedDates; delete meta.lastResponseAdjustment;
  const payload = { version: 1, bars: snapshot.bars, meta };
  const revision = createHash("sha256").update(JSON.stringify(payload)).digest("hex"), bytes = JSON.stringify({ ...payload, revision });
  const head = join(root, "data", source, "AAPL", "snapshot.json"), archive = join(root, "data", source, "AAPL", "revisions", `${revision}.json`);
  writeFileSync(head, bytes); writeFileSync(archive, bytes);
  const cache = await loadCachedBars("AAPL", source, start, end);
  expect(cache.fresh).toBe(false); expect(cache.bars).toEqual(original);
  expect(loadDataset({ ...ref, revision })).toEqual(original); expect(readFileSync(head, "utf8")).toBe(bytes);
});

test("legacy zero-turnover cache stays identifiable while a new response gains verified nullable semantics", async () => {
  const reportedZero = { ...bar(start, 100), amount: 0 };
  const ref = (await saveBars("AAPL", source, [reportedZero], start, start))!;
  const snapshot = readBarsSnapshot("AAPL", source)!;
  const { turnoverSemantics: _marker, ...legacyMeta } = snapshot.meta;
  const payload = { version: 1, bars: snapshot.bars, meta: legacyMeta };
  const revision = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const bytes = JSON.stringify({ ...payload, revision });
  const dir = join(root, "data", source, "AAPL");
  writeFileSync(join(dir, "snapshot.json"), bytes);
  writeFileSync(join(dir, "revisions", `${revision}.json`), bytes);
  const legacyRef = { ...ref, revision };
  expect((await loadCachedBars("AAPL", source, start, start)).turnoverSemantics).toBe("legacy-unknown");
  const result = await fetchBars("AAPL", "US", start, start, "auto", {
    deps: { loadCache: loadCachedBars, saveBars, getPreferredSource: () => source },
    providers: { fallbackOrder: { US: [source] }, adapters: { [source]: { fetchBars: async () => [reportedZero] } } },
  });
  // The old cache is fresh and must be attributed to its existing unverified revision.
  expect(result).toMatchObject({ origin: "cache", turnoverSemantics: "legacy-unknown" });
  expect(readFileSync(join(dir, "revisions", `${revision}.json`), "utf8")).toBe(bytes);
  expect(loadDataset(legacyRef)).toEqual([reportedZero]);
  await saveBars("AAPL", source, [{ ...reportedZero, amount: null }], start, start);
  const refreshed = await loadCachedBars("AAPL", source, start, start);
  expect(refreshed).toMatchObject({ bars: [{ amount: null }], turnoverSemantics: "nullable" });
  expect(loadDataset(legacyRef)).toEqual([reportedZero]);
});

test("rejects malformed response membership even with a recomputed content hash, without changing files", async () => {
  await saveBars("AAPL", source, original, start, end);
  const snapshot = readBarsSnapshot("AAPL", source)!, head = join(root, "data", source, "AAPL", "snapshot.json");
  const cases = [null, [], [end, start], [start, start], ["2026-02-30"], ["2025-12-31"], ["2026-01-04"], "not-an-array"];
  for (const fetchedDates of cases) {
    const payload = { version: 1, bars: snapshot.bars, meta: { ...snapshot.meta, fetchedDates } };
    const bytes = JSON.stringify({ ...payload, revision: createHash("sha256").update(JSON.stringify(payload)).digest("hex") });
    writeFileSync(head, bytes);
    expect(readBarsSnapshot("AAPL", source)).toBeNull();
    expect(await loadCachedBars("AAPL", source, start, end)).toEqual({ bars: [], fresh: false });
    expect(readFileSync(head, "utf8")).toBe(bytes);
  }
  // A date present in merged history still cannot be claimed outside the last request range.
  const invalid: BarsSnapshot = structuredClone(snapshot);
  invalid.meta.fetchedRange = { start: end, end };
  invalid.revision = createHash("sha256").update(JSON.stringify({ version: 1, bars: invalid.bars, meta: invalid.meta })).digest("hex");
  writeFileSync(head, JSON.stringify(invalid)); expect(readBarsSnapshot("AAPL", source)).toBeNull();
});

test("rejects a contradictory OHLC head even when its revision hash is recomputed, preserving the old archive", async () => {
  const ref = (await saveBars("AAPL", source, original, start, end))!;
  const snapshot = readBarsSnapshot("AAPL", source)!;
  const head = join(root, "data", source, "AAPL", "snapshot.json");
  const payload = { version: 1, bars: [{ ...snapshot.bars[0]!, high: 90, low: 100 }, ...snapshot.bars.slice(1)], meta: snapshot.meta };
  const bytes = JSON.stringify({ ...payload, revision: createHash("sha256").update(JSON.stringify(payload)).digest("hex") });
  writeFileSync(head, bytes);
  expect(readBarsSnapshot("AAPL", source)).toBeNull();
  expect(await loadCachedBars("AAPL", source, start, end)).toEqual({ bars: [], fresh: false });
  expect(readFileSync(head, "utf8")).toBe(bytes);
  expect(loadDataset(ref)).toEqual(original);
});
