import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { lockSync } from "proper-lockfile";
import { loadBars, loadCachedBars, loadDataset, readBarsSnapshot, saveBars } from "../src/bars.ts";
import type { Bar, DatasetRef } from "../../types/data.ts";

let root: string;
let previous: string | undefined;
const bar = (date: string, close = 10): Bar => ({ date, open: close, high: close, low: close, close, volume: 10, amount: 100 });
const fixture = join(import.meta.dir, "fixtures", "bar-writer.ts");

beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "ohq-snapshot-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR;
  else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected snapshot test directory");
  rmSync(root, { recursive: true, force: true });
});

describe("public data snapshots", () => {
  it("pins exact observations across later corrections and filters selected windows", async () => {
    const original = [bar("2026-01-01"), bar("2026-01-02", 11), bar("2026-01-03", 12)];
    const ref = await saveBars("AAPL", "financial-datasets", original);
    const window = await loadCachedBars("AAPL", "financial-datasets", "2026-01-02", "2026-01-03");
    await saveBars("AAPL", "financial-datasets", [bar("2026-01-02", 50)]);
    expect((await loadBars("AAPL", "financial-datasets"))[1]!.close).toBe(50);
    expect(loadDataset(ref!)).toEqual(original);
    expect(loadDataset(window.dataset!)).toEqual(original.slice(1));
    expect(readBarsSnapshot("AAPL", "financial-datasets")!.revision).not.toBe(ref!.revision);
    expect(() => loadDataset({ ...ref!, contentHash: "0".repeat(64) })).toThrow("does not match");
    expect(() => loadDataset({ ...ref!, revision: "../settings" })).toThrow("Invalid dataset revision");
  });

  it("does not extend freshness of merged old history after a narrow update", async () => {
    await saveBars("AAPL", "financial-datasets", [bar("2025-01-01"), bar("2026-01-01")], "2025-01-01", "2026-01-01");
    await saveBars("AAPL", "financial-datasets", [bar("2026-01-02")], "2026-01-02", "2026-01-02");
    expect((await loadCachedBars("AAPL", "financial-datasets", "2025-01-01", "2026-01-02")).fresh).toBe(false);
    expect((await loadCachedBars("AAPL", "financial-datasets", "2026-01-02", "2026-01-02")).fresh).toBe(true);
    expect((await loadBars("AAPL", "financial-datasets"))).toHaveLength(3);
  });

  it("rejects references that change observation order, window or historical-availability claims", async () => {
    const ref = (await saveBars("AAPL", "financial-datasets", [bar("2026-01-01"), bar("2026-01-02")]))!;
    for (const changed of [
      { dates: [...ref.dates].reverse() },
      { dates: [ref.dates[0], ref.dates[0]] },
      { requested: { start: "2026-01-02", end: null } },
      { requested: { start: null, end: "2025-12-31" } },
      { requested: { start: "2026-02-30", end: null } },
      { requested: undefined },
      { revision: undefined },
      { adjustment: "split-adjusted" },
      { availability: "point-in-time" },
    ]) expect(() => loadDataset({ ...ref, ...changed } as DatasetRef)).toThrow();
    expect(loadDataset(ref).map(row => row.date)).toEqual(["2026-01-01", "2026-01-02"]);
  });

  it("treats legacy paired files as stale and migrates only on a successful pull", async () => {
    const dir = join(root, "data", "financial-datasets", "AAPL");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "daily.json"), JSON.stringify([bar("2026-01-01")]));
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ fetchedAt: new Date().toISOString(), fetchedRange: { start: null, end: null } }));
    expect(await loadCachedBars("AAPL", "financial-datasets")).toEqual({ bars: [bar("2026-01-01")], fresh: false });
    await saveBars("AAPL", "financial-datasets", []);
    expect(existsSync(join(dir, "snapshot.json"))).toBe(false);
    await saveBars("AAPL", "financial-datasets", [bar("2026-01-02")]);
    expect((await loadBars("AAPL", "financial-datasets"))).toHaveLength(2);
    const snapshot = JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8"));
    snapshot.meta.rowCount = 999;
    writeFileSync(join(dir, "snapshot.json"), JSON.stringify(snapshot));
    expect(await loadCachedBars("AAPL", "financial-datasets")).toEqual({ bars: [], fresh: false });
  });

  it("cancels a writer waiting on another process without committing", async () => {
    await saveBars("AAPL", "financial-datasets", [bar("2026-01-01")]);
    const head = readBarsSnapshot("AAPL", "financial-datasets")!;
    const path = join(root, "data", "financial-datasets", "AAPL", "snapshot.json");
    const release = lockSync(path, { realpath: false, stale: 10_000, update: 2_000 });
    const controller = new AbortController();
    try {
      const pending = saveBars("AAPL", "financial-datasets", [bar("2026-01-02")], undefined, undefined, controller.signal);
      controller.abort();
      await expect(pending).rejects.toThrow();
      expect(readBarsSnapshot("AAPL", "financial-datasets")).toEqual(head);
    } finally { release(); }
  });

  it("merges updates from eight separate processes without torn reads or lost dates", async () => {
    await saveBars("AAPL", "financial-datasets", [bar("2025-12-31")]);
    const writers = Array.from({ length: 8 }, (_, i) => Bun.spawn([process.execPath, fixture, String(i)], {
      env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe",
    }));
    try {
      // Read during contention; every published generation must validate its entire pair.
      for (let i = 0; i < 20; i++) {
        expect(readBarsSnapshot("AAPL", "financial-datasets")).not.toBeNull();
        await Bun.sleep(10);
      }
      const exits = await Promise.all(writers.map(async writer => ({ code: await writer.exited, error: await new Response(writer.stderr).text() })));
      expect(exits).toEqual(Array.from({ length: 8 }, () => ({ code: 0, error: "" })));
      const snapshot = readBarsSnapshot("AAPL", "financial-datasets")!;
      expect(snapshot.bars.map(row => row.date)).toEqual(["2025-12-31", ...Array.from({ length: 8 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`)]);
      expect(snapshot.meta.rowCount).toBe(9);
    } finally {
      for (const writer of writers) if (writer.exitCode === null) writer.kill();
      await Promise.all(writers.map(writer => writer.exited));
    }
  }, 15_000);

  it("keeps the committed generation when killed between archive and head, then recovers the lease", async () => {
    const original = await saveBars("AAPL", "financial-datasets", [bar("2025-12-31")]);
    const writer = Bun.spawn([process.execPath, fixture, "0", "crash"], { env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe" });
    try {
      const deadline = Date.now() + 5_000;
      while (!existsSync(join(root, "archive-written")) && Date.now() < deadline && writer.exitCode === null) await Bun.sleep(10);
      expect(existsSync(join(root, "archive-written"))).toBe(true);
      writer.kill(9);
      await writer.exited;
      expect(readBarsSnapshot("AAPL", "financial-datasets")!.revision).toBe(original!.revision);
      const dir = join(root, "data", "financial-datasets", "AAPL");
      const revisions = readdirSync(join(dir, "revisions"));
      expect(revisions.filter(file => file.endsWith(".json"))).toHaveLength(2);
      expect(revisions.filter(file => file.endsWith(".commit"))).toEqual([`${original!.revision}.commit`]);
      // Simulate elapsed lease time only after verifying that its owner is terminal.
      const lock = join(dir, "snapshot.json.lock");
      if (existsSync(lock)) utimesSync(lock, new Date(0), new Date(0));
      writeFileSync(join(dir, "snapshot.json.crashed.tmp"), '{"bars":[');
      await saveBars("AAPL", "financial-datasets", [bar("2026-01-02")]);
      expect((await loadBars("AAPL", "financial-datasets")).map(row => row.date)).toEqual(["2025-12-31", "2026-01-02"]);
      expect(loadDataset(original!)).toEqual([bar("2025-12-31")]);
    } finally {
      if (writer.exitCode === null) writer.kill(9);
      await writer.exited;
    }
  }, 15_000);
});
