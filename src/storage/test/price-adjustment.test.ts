import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { loadArchivedBarsBefore, loadBars, loadCachedBars, loadDataset, readBarsSnapshot, saveBars } from "../src/bars.ts";
import { fetchBars, fetchLiveBars, pullBarsFromProviders } from "../../source/src/sources.ts";
import { createPriceAnalysisTools } from "../../tools/quant-tools.ts";
import { buildResearchReport, resolveResearchBars } from "../../research/input.ts";
import { renderShareReport } from "../../artifact/src/research-renderer.ts";
import { researchEntries, researchMessages } from "../../research/test/fixtures.ts";
import type { SourceFetchOptions } from "../../source/src/source-contracts.ts";
import type { Bar, PriceAdjustment } from "../../types/data.ts";

let root: string, previous: string | undefined;
const bar = (date: string, close: number): Bar => ({ date, open: close, high: close, low: close, close, volume: 10, amount: null });
const symbol = "000001.SZ", start = "2026-01-01", end = "2026-01-03";
const older = [bar(start, 100), bar("2026-01-02", 110)];
const rebased = [bar("2026-01-02", 55), bar(end, 60)];
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-adjustment-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected adjustment fixture directory");
  rmSync(root, { recursive: true, force: true });
});
const store = (rows: Bar[], mode: PriceAdjustment) => saveBars(symbol, "akshare", rows, start, end, undefined, "stock_zh_a_hist", mode);

test("qfq rebasing never splices stale levels into the head, while old observed revisions remain reproducible", async () => {
  const first = (await store(older, "forward-adjusted"))!;
  const archive = join(root, "data", "akshare", symbol, "revisions", `${first.revision}.json`);
  const bytes = readFileSync(archive, "utf8");
  const second = (await store(rebased, "forward-adjusted"))!;
  expect(await loadBars(symbol, "akshare")).toEqual(rebased); // A stale 100 before 55 would invent a 45% loss.
  expect(loadDataset(first)).toEqual(older);
  expect(loadDataset(second)).toEqual(rebased);
  expect(readFileSync(archive, "utf8")).toBe(bytes);
  const cached = await loadCachedBars(symbol, "akshare", start, end);
  expect(cached.dataset).toEqual(second);
  expect(cached.dataset?.adjustment).toBe("forward-adjusted");
  const archived = await loadArchivedBarsBefore(symbol, "akshare", start, end, second.snapshotAt);
  expect(archived.dataset?.adjustment).toBe("forward-adjusted");
  expect(() => loadDataset({ ...second, adjustment: "unadjusted" })).toThrow("does not match");
  expect(() => resolveResearchBars({ ...second, adjustment: "unit-nav" })).toThrow("does not match");
});

test("a basis change resets accumulated history without relabeling archived observations", async () => {
  const first = (await store(older, "unadjusted"))!;
  const second = (await store(rebased, "forward-adjusted"))!;
  const third = (await store([bar(end, 120)], "unadjusted"))!;
  expect(await loadBars(symbol, "akshare")).toEqual([bar(end, 120)]);
  expect(loadDataset(first)).toEqual(older);
  expect(loadDataset(second)).toEqual(rebased);
  expect(loadDataset(third)).toEqual([bar(end, 120)]);
  await store([bar("2026-01-02", 110)], "unadjusted");
  expect((await loadBars(symbol, "akshare")).map(row => row.close)).toEqual([110, 120]);
});

test("old snapshots with no basis remain unknown, then a known response cannot inherit their rows", async () => {
  const ref = (await saveBars(symbol, "akshare", older, start, end))!;
  const snapshot = readBarsSnapshot(symbol, "akshare")!;
  const { lastResponseAdjustment: _basis, ...meta } = snapshot.meta;
  const payload = { version: 1 as const, bars: snapshot.bars, meta };
  const revision = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const legacy = { ...payload, revision };
  writeFileSync(join(root, "data", "akshare", symbol, "snapshot.json"), JSON.stringify(legacy));
  writeFileSync(join(root, "data", "akshare", symbol, "revisions", `${revision}.json`), JSON.stringify(legacy));
  const oldRef = { ...ref, revision };
  expect(loadDataset(oldRef)).toEqual(older);
  expect((await loadCachedBars(symbol, "akshare", start, end)).dataset?.adjustment).toBe("provider-unspecified");
  await store(rebased, "unadjusted");
  expect(await loadBars(symbol, "akshare")).toEqual(rebased);
  expect(loadDataset(oldRef)).toEqual(older);
});

test("source, cache, offline fallback and recovered report preserve the exact price basis", async () => {
  let calls = 0;
  const options: SourceFetchOptions = {
    deps: { loadCache: loadCachedBars, loadArchiveBefore: loadArchivedBarsBefore, saveBars, getPreferredSource: () => "akshare" },
    providers: { fallbackOrder: { A: ["akshare"] }, adapters: {
      akshare: { fetchBars: async () => { calls++; return { bars: rebased, endpoint: "stock_zh_a_hist", adjustment: "forward-adjusted" }; } },
    } },
  };
  const fresh = await fetchBars(symbol, "A", start, end, "akshare", options);
  const cached = await fetchBars(symbol, "A", start, end, "auto", options);
  expect(cached.dataset).toEqual(fresh.dataset);
  expect(cached.adjustment).toBe("forward-adjusted");
  expect(calls).toBe(1);
  const offline = await fetchBars(symbol, "A", start, end, "akshare", { ...options, providers: { ...options.providers,
    adapters: { akshare: { fetchBars: async () => { throw new Error("offline"); } } } } });
  expect(offline.origin).toBe("stale-cache");
  expect(offline.adjustment).toBe("forward-adjusted");
  const archived = await fetchBars(symbol, "A", start, end, "akshare", { ...options, observedBefore: fresh.dataset!.snapshotAt });
  expect(archived.adjustment).toBe("forward-adjusted");
  expect(calls).toBe(1);
  const tools = createPriceAnalysisTools(async () => cached);
  const args = { symbol, factor: "momentum" as const, period: 1, start, end };
  const result = await tools.computeFactorTool.execute("research-call", args);
  expect(result.content).toMatchObject([{ type: "text", text: expect.stringContaining("forward-adjusted") }]);
  const report = buildResearchReport({ lines: researchEntries(researchMessages("compute_factor", args, result.details)) });
  expect(report.exclusions.unavailableInputs).toBe(0);
  expect(report.analyses).toHaveLength(1);
  expect(report.datasets[0]?.ref.adjustment).toBe("forward-adjusted");
  expect(report.analyses[0]!.metrics[0]!.value).toBeCloseTo(60 / 55 - 1, 12);
  expect(renderShareReport(report)).toContain("historical levels may change");
  const tampered = { ...(result.details as Record<string, unknown>), dataset: { ...fresh.dataset!, adjustment: "unadjusted" } };
  const rejected = buildResearchReport({ lines: researchEntries(researchMessages("compute_factor", args, tampered)) });
  expect(rejected.analyses).toEqual([]);
  expect(rejected.exclusions.unavailableInputs).toBe(1);
  const live = await fetchLiveBars(symbol, "A", start, end, options);
  expect(live.adjustment).toBe("forward-adjusted");
});

test("invalid adapter metadata is rejected before save and fallback keeps its own basis", async () => {
  let saved = 0;
  const result = await fetchBars(symbol, "A", start, end, "akshare", {
    deps: { loadCache: async () => ({ bars: [], fresh: false }), saveBars: async () => { saved++; }, getPreferredSource: () => "akshare" },
    providers: { adapters: {
      akshare: { fetchBars: async () => ({ bars: older, endpoint: "stock_zh_a_hist", adjustment: "invented" as PriceAdjustment }) },
      tushare: { fetchBars: async () => ({ bars: older, endpoint: "daily", adjustment: "unadjusted" }) },
    } },
  });
  expect(saved).toBe(1);
  expect(result.source).toBe("tushare");
  expect(result.adjustment).toBe("unadjusted");
  expect(result.attempts[0]).toMatchObject({ status: "error", error: "Provider response invalid" });
  // An array-only injected adapter named AKShare provides no basis evidence.
  const unknown = await pullBarsFromProviders(symbol, "A", start, end, "akshare", {
    adapters: { akshare: { fetchBars: async () => older } }, fallbackOrder: { A: ["akshare"] },
  });
  expect(unknown.adjustment).toBeUndefined();
  await expect(store(older, "invented" as PriceAdjustment)).rejects.toThrow("Invalid price adjustment");
  expect(readBarsSnapshot(symbol, "akshare")).toBeNull();
});
