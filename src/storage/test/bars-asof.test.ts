import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fetchBars } from "../../source/src/sources.ts";
import { fetchArchivedBarsTool } from "../../tools/data-tools.ts";
import { loadArchivedBarsBefore, loadCachedBars, loadDataset, readBarsSnapshot, saveBars } from "../src/bars.ts";
import { subscribeFileEvents } from "../src/fs-events.ts";
import type { Bar, BarsSnapshot } from "../../types/data.ts";

let root: string, previous: string | undefined;
let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
const source = "financial-datasets", symbol = "AAPL", start = "2025-01-06", end = "2025-01-07";
const cutoff = "2025-01-08T00:00:00.000Z";
const bar = (date: string, close: number): Bar => ({ date, open: close, high: close, low: close, close, volume: 10, amount: null });

beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-asof-bars-")); process.env.OHQUANT_DIR = root;
  network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Archive-only request reached provider transport"));
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); network.mockRestore();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected as-of fixture directory");
  rmSync(root, { recursive: true, force: true });
});

/** Synthetic old observation: use a distinct immutable revision, never rewrite the current head. */
function archivedAt(snapshot: BarsSnapshot, observedAt: string): string {
  const payload = { version: 1 as const, bars: snapshot.bars, meta: { ...snapshot.meta, fetchedAt: observedAt } };
  const revision = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const committed = { ...payload, revision };
  const dir = join(root, "data", source, symbol, "revisions");
  writeFileSync(join(dir, `${revision}.json`), JSON.stringify(committed));
  writeFileSync(join(dir, `${revision}.commit`), JSON.stringify({ version: 1, revision,
    snapshotHash: createHash("sha256").update(JSON.stringify(committed)).digest("hex") }));
  return revision;
}

test("archive-only cutoff selects a saved old response and never uses a later price revision or provider", async () => {
  const earlier = [bar(start, 100), bar(end, 110)];
  await saveBars(symbol, source, earlier, start, end);
  const revision = archivedAt(readBarsSnapshot(symbol, source)!, "2025-01-07T23:00:00.000Z");
  await saveBars(symbol, source, [bar(start, 900), bar(end, 990)], start, end);
  let providerCalls = 0, writes = 0;
  const result = await fetchBars(symbol, "US", start, end, source, {
    observedBefore: cutoff,
    deps: { loadCache: loadCachedBars, loadArchiveBefore: loadArchivedBarsBefore,
      saveBars: async () => { writes++; }, getPreferredSource: () => source },
    providers: { adapters: { [source]: { fetchBars: async () => { providerCalls++; return [bar(start, 9999)]; } } } },
  });
  expect(result).toMatchObject({ origin: "cache", bars: earlier, observationAt: "2025-01-07T23:00:00.000Z",
    historicalBoundary: { observedBefore: cutoff, evidence: "app-archive" }, dataset: { revision, availability: "observed-at-fetch" } });
  expect(loadDataset(result.dataset!)).toEqual(earlier);
  expect(providerCalls).toBe(0); expect(writes).toBe(0);
  expect(readBarsSnapshot(symbol, source)?.bars.map(row => row.close)).toEqual([900, 990]);
});

test("archive-only cutoff cannot stitch missing rows, use a later head, or ignore damaged revisions", async () => {
  await saveBars(symbol, source, [bar(end, 120)], end, end);
  archivedAt(readBarsSnapshot(symbol, source)!, "2025-01-07T23:00:00.000Z");
  const empty = await loadArchivedBarsBefore(symbol, source, start, end, cutoff);
  expect(empty).toEqual({ bars: [], fresh: false });
  const unavailable = await fetchArchivedBarsTool.execute("no-past-window", { symbol, market: "US", source, start, end, observed_before: cutoff });
  expect(unavailable.details).toMatchObject({ error: { code: "DATA_NO_ASOF_ARCHIVE" } });
  expect((await loadCachedBars(symbol, source, start, end)).bars).toEqual([bar(end, 120)]);
  const bad = "a".repeat(64), file = join(root, "data", source, symbol, "revisions", `${bad}.json`);
  writeFileSync(file, "corrupt archive");
  await expect(loadArchivedBarsBefore(symbol, source, start, end, cutoff)).rejects.toThrow("unavailable");
  const damaged = await fetchArchivedBarsTool.execute("damaged", { symbol, market: "US", source, start, end, observed_before: cutoff });
  expect(damaged.details).toMatchObject({ error: { code: "DATA_ASOF_ARCHIVE_UNAVAILABLE" } });
  expect(readFileSync(file, "utf8")).toBe("corrupt archive");
});

test("fetch_bars_archive exposes price date separately from observation time and rejects malformed historical cutoffs", async () => {
  await saveBars(symbol, source, [bar(start, 100), bar(end, 110)], start, end);
  const revision = archivedAt(readBarsSnapshot(symbol, source)!, "2025-01-07T23:00:00.000Z");
  const invalid = await fetchArchivedBarsTool.execute("invalid", { symbol, market: "US", start, end, source, observed_before: "2025-02-30T00:00:00.000Z" });
  expect(invalid.details).toMatchObject({ error: { code: "DATA_INVALID_OBSERVATION_CUTOFF" } });
  const result = await fetchArchivedBarsTool.execute("archive", { symbol, market: "US", start, end, source, observed_before: cutoff });
  const text = result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
  expect(result.details).toMatchObject({ dataset: { revision }, historicalBoundary: { observedBefore: cutoff, evidence: "app-archive" },
    latestBarDate: end, observationAt: "2025-01-07T23:00:00.000Z" });
  expect(text).toContain(`Price date  ${end}`);
  expect(text).toContain("App observed 2025-01-07T23:00:00.000Z");
  expect(text).toContain("not provider publication or complete trading-calendar evidence");
});

test("explicit-source archive read does not prepare provider settings or credentials", async () => {
  await saveBars(symbol, source, [bar(start, 100), bar(end, 110)], start, end);
  archivedAt(readBarsSnapshot(symbol, source)!, "2025-01-07T23:00:00.000Z");
  const broken = join(root, "settings.json");
  writeFileSync(broken, "{malformed provider config");
  const result = await fetchArchivedBarsTool.execute("offline", { symbol, market: "US", source, start, end, observed_before: cutoff });
  expect(result.details).toMatchObject({ source, historicalBoundary: { evidence: "app-archive" }, barCount: 2 });
  expect(readFileSync(broken, "utf8")).toBe("{malformed provider config");
});

test("cancelling between revision and head commit leaves no uncommitted history observation", async () => {
  await saveBars(symbol, source, [bar(start, 100)], start, start);
  const previousRevision = readBarsSnapshot(symbol, source)!.revision;
  const controller = new AbortController();
  const unsubscribe = subscribeFileEvents(event => {
    if (event.operation === "WRITE" && event.detail === "immutable bars revision" && event.path.endsWith(".json"))
      controller.abort(new Error("research cancelled before head commit"));
  });
  try {
    await expect(saveBars(symbol, source, [bar(end, 110)], end, end, controller.signal)).rejects.toThrow("research cancelled");
  } finally { unsubscribe(); }
  expect(readBarsSnapshot(symbol, source)?.revision).toBe(previousRevision);
  expect(readdirSync(join(root, "data", source, symbol, "revisions")).filter(file => file.endsWith(".json"))).toHaveLength(1);
  expect(await loadArchivedBarsBefore(symbol, source, end, end, "2027-01-01T00:00:00.000Z"))
    .toEqual({ bars: [], fresh: false });
});

test("a crashed writer's unmarked new revision cannot enter history or a forged DatasetRef", async () => {
  const older = bar(start, 100), newest = bar(end, 110);
  const olderRef = (await saveBars(symbol, source, [older], start, start))!;
  const script = `
    import { saveBars } from "./src/storage/src/bars.ts";
    import { subscribeFileEvents } from "./src/storage/src/fs-events.ts";
    subscribeFileEvents(event => {
      if (event.operation === "WRITE" && event.detail === "immutable bars revision") process.exit(77);
    });
    await saveBars("AAPL", "financial-datasets", [{ date: "2025-01-07", open: 110, high: 110, low: 110,
      close: 110, volume: 10, amount: null }], "2025-01-07", "2025-01-07");
  `;
  const child = Bun.spawnSync({ cmd: [process.execPath, "-e", script], cwd: process.cwd(),
    env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe", timeout: 10_000 });
  expect(child.exitCode).toBe(77);
  expect(readBarsSnapshot(symbol, source)?.revision).toBe(olderRef.revision);
  const dir = join(root, "data", source, symbol, "revisions");
  const orphan = readdirSync(dir).find(file => file.endsWith(".json") && file !== `${olderRef.revision}.json`);
  expect(orphan).toBeDefined();
  const orphanSnapshot = readBarsSnapshot(symbol, source, orphan!.slice(0, -5))!;
  expect(orphanSnapshot.meta.archiveCommitProtocol).toBe("head-or-marker-v1");
  expect(await loadArchivedBarsBefore(symbol, source, end, end, "2027-01-01T00:00:00.000Z"))
    .toEqual({ bars: [], fresh: false });
  const forged = { ...olderRef, revision: orphanSnapshot.revision, contentHash: createHash("sha256").update(JSON.stringify([newest])).digest("hex"),
    dates: [end], requested: { start: end, end }, snapshotAt: orphanSnapshot.meta.fetchedAt };
  expect(() => loadDataset(forged)).toThrow("uncommitted");
  const committed = (await saveBars(symbol, source, [newest], end, end))!;
  expect(loadDataset(olderRef)).toEqual([older]);
  expect(loadDataset(committed)).toEqual([newest]);
});

test("a crash after the head commit remains readable and the next save backfills its marker", async () => {
  await saveBars(symbol, source, [bar(start, 100)], start, start);
  const script = `
    import { saveBars } from "./src/storage/src/bars.ts";
    import { subscribeFileEvents } from "./src/storage/src/fs-events.ts";
    subscribeFileEvents(event => {
      if (event.operation === "WRITE" && event.detail === "bars snapshot") process.exit(78);
    });
    await saveBars("AAPL", "financial-datasets", [{ date: "2025-01-07", open: 110, high: 110, low: 110,
      close: 110, volume: 10, amount: null }], "2025-01-07", "2025-01-07");
  `;
  const child = Bun.spawnSync({ cmd: [process.execPath, "-e", script], cwd: process.cwd(),
    env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe", timeout: 10_000 });
  expect(child.exitCode).toBe(78);
  const crashedHead = readBarsSnapshot(symbol, source)!;
  const marker = join(root, "data", source, symbol, "revisions", `${crashedHead.revision}.commit`);
  expect(existsSync(marker)).toBe(false);
  const cached = await loadCachedBars(symbol, source, end, end);
  expect(cached.bars).toEqual([bar(end, 110)]);
  expect(loadDataset(cached.dataset!)).toEqual([bar(end, 110)]);
  expect((await loadArchivedBarsBefore(symbol, source, end, end, "2027-01-01T00:00:00.000Z")).bars)
    .toEqual([bar(end, 110)]);
  await saveBars(symbol, source, [bar("2025-01-08", 120)], "2025-01-08", "2025-01-08");
  expect(existsSync(marker)).toBe(true);
  expect(loadDataset(cached.dataset!)).toEqual([bar(end, 110)]);
});

test("a damaged commit marker blocks an older new-format revision without losing the current head", async () => {
  const older = bar(start, 100), newest = bar(end, 110);
  const olderRef = (await saveBars(symbol, source, [older], start, start))!;
  const latestRef = (await saveBars(symbol, source, [newest], end, end))!;
  const markerPath = join(root, "data", source, symbol, "revisions", `${olderRef.revision}.commit`);
  writeFileSync(markerPath, "{damaged marker");
  expect(() => loadDataset(olderRef)).toThrow("damaged commit marker");
  await expect(loadArchivedBarsBefore(symbol, source, start, start, "2027-01-01T00:00:00.000Z"))
    .rejects.toThrow("damaged commit marker");
  expect(loadDataset(latestRef)).toEqual([newest]);
});

test("an unmarked legacy orphan is not historical evidence while the legacy head can be certified on the next save", async () => {
  const original = bar(start, 100), orphan = bar(start, 777);
  const firstRef = (await saveBars(symbol, source, [original], start, start))!;
  const first = readBarsSnapshot(symbol, source)!;
  const { archiveCommitProtocol: _protocol, ...legacyMeta } = first.meta;
  const legacyPayload = { version: 1 as const, bars: first.bars, meta: legacyMeta };
  const legacyRevision = createHash("sha256").update(JSON.stringify(legacyPayload)).digest("hex");
  const dir = join(root, "data", source, symbol), revisions = join(dir, "revisions");
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify({ ...legacyPayload, revision: legacyRevision }));
  const orphanAt = "2025-01-06T23:00:00.000Z";
  const orphanPayload = { version: 1 as const, bars: [orphan], meta: { ...legacyMeta, fetchedAt: orphanAt } };
  const orphanRevision = createHash("sha256").update(JSON.stringify(orphanPayload)).digest("hex");
  writeFileSync(join(revisions, `${orphanRevision}.json`), JSON.stringify({ ...orphanPayload, revision: orphanRevision }));
  expect((await loadArchivedBarsBefore(symbol, source, start, start, cutoff)).bars).toEqual([]);
  const forged = { ...firstRef, revision: orphanRevision, contentHash: createHash("sha256").update(JSON.stringify([orphan])).digest("hex"),
    snapshotAt: orphanAt };
  expect(() => loadDataset(forged)).toThrow("uncommitted");

  const legacyRef = { ...firstRef, revision: legacyRevision };
  await saveBars(symbol, source, [bar(end, 110)], end, end);
  expect(existsSync(join(revisions, `${legacyRevision}.json`))).toBe(true);
  expect(existsSync(join(revisions, `${legacyRevision}.commit`))).toBe(true);
  expect(loadDataset(legacyRef)).toEqual([original]);
  expect((await loadArchivedBarsBefore(symbol, source, start, start, "2027-01-01T00:00:00.000Z")).bars).toEqual([original]);
});
