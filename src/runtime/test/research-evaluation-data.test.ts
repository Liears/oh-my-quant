import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { readBarsSnapshot, saveBars } from "../../storage/index.ts";
import { createEvaluationPriceData } from "../evaluation/research-evaluation.ts";

let root: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-evaluation-data-test-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected evaluation fixture directory");
  rmSync(root, { recursive: true, force: true });
});

it("binds successive same-key stock and risk fixtures to their own immutable archives", async () => {
  const observations = [];
  for (const id of ["stock", "risk", "risk", "stock"] as const) {
    const result = await createEvaluationPriceData(id)("AAPL", 40, "2026-01-01", "2026-02-09");
    expect(result.dataset).toBeDefined();
    const archive = readBarsSnapshot("AAPL", "financial-datasets", result.dataset!.revision);
    expect(archive?.bars).toEqual(result.bars);
    observations.push(result);
  }
  expect(observations[0]!.dataset!.revision).not.toBe(observations[1]!.dataset!.revision);
  expect(observations[1]!.dataset).toEqual(observations[2]!.dataset);
  expect(observations[0]!.bars[1]!.close).toBe(101);
  expect(observations[1]!.bars[1]!.close).toBe(110);
  expect(observations[3]!.bars).toEqual(observations[0]!.bars);
  for (const result of observations) {
    expect(readBarsSnapshot("AAPL", "financial-datasets", result.dataset!.revision)?.bars).toEqual(result.bars);
  }
});

it("does not reuse a same-price archive whose volume differs from the fixture", async () => {
  const load = createEvaluationPriceData("stock");
  const original = await load("AAPL", 40, "2026-01-01", "2026-02-09");
  const changed = original.bars.map((bar, index) => ({ ...bar, volume: index === 39 ? 999 : bar.volume }));
  const stale = await saveBars("AAPL", "financial-datasets", changed, "2026-01-01", "2026-02-09");
  if (!stale) throw new Error("Synthetic archive was not saved");
  const result = await load("AAPL", 40, "2026-01-01", "2026-02-09");
  expect(result.dataset!.revision).not.toBe(stale.revision);
  expect(result.bars).toEqual(original.bars);
  expect(readBarsSnapshot("AAPL", "financial-datasets", result.dataset!.revision)?.bars).toEqual(result.bars);
  expect(readBarsSnapshot("AAPL", "financial-datasets", stale.revision)?.bars).toEqual(changed);
});
