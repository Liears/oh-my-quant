import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMeta, loadBars, saveBars } from "../src/bars.ts";
import type { Bar } from "../../types/data.ts";

const previousDir = process.env.OHQUANT_DIR;
let testDir: string | undefined;
afterEach(() => {
  if (previousDir === undefined) delete process.env.OHQUANT_DIR;
  else process.env.OHQUANT_DIR = previousDir;
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

describe("daily bars revisions", () => {
  it("replaces same-session values while retaining history and sorting dates", async () => {
    testDir = mkdtempSync(join(tmpdir(), "whyj-bars-"));
    process.env.OHQUANT_DIR = testDir;
    const b: Bar = { date: "2026-10-12", open: 10, high: 11, low: 9, close: 10, volume: 100, amount: 1000 };
    await saveBars("600000.SH", "akshare", [b, { ...b, date: "2026-10-13" }]);
    await saveBars("600000.SH", "akshare", [{ ...b, date: "2026-10-13", close: 11, volume: 200 },
      { ...b, date: "2026-10-09" }, { ...b, date: "2026-10-13", close: 10.5, volume: 300 }]);
    const r = await loadBars("600000.SH", "akshare");
    expect(r.map((bar) => bar.date)).toEqual(["2026-10-09", "2026-10-12", "2026-10-13"]);
    expect(r.at(-1)).toMatchObject({ close: 10.5, volume: 300 });
    expect((await getMeta("600000.SH", "akshare"))?.rowCount).toBe(3);
  });
});
