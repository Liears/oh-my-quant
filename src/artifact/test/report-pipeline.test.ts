import { afterEach, beforeEach, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { loadReportSession } from "../src/report-input.ts";
import { buildResearchReport } from "../../research/input.ts";
import { verifyResearchAnalysis } from "../../research/analysis.ts";
import { renderResearchResults, renderShareReport } from "../src/research-renderer.ts";
import type { ResearchBarsDataset, ResearchReport } from "../../research/types.ts";

let root: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-report-pipeline-"));
  process.env.OHQUANT_DIR = root;
  writeFileSync(join(root, "settings.json"), "invalid-local-settings");
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected pipeline fixture directory");
  rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const bars = [100, 200, 400].map((close, index) => ({ date: `2026-01-0${index + 5}`, open: close, high: close, low: close, close, volume: 1, amount: close }));
  const dataset: ResearchBarsDataset = { bars, ref: { version: 1, kind: "daily-bars", symbol: "AAPL", market: "US", source: "financial-datasets",
    revision: "a".repeat(64), contentHash: createHash("sha256").update(JSON.stringify(bars)).digest("hex"), dates: bars.map(bar => bar.date),
    requested: { start: null, end: null }, snapshotAt: "2026-01-08T00:00:00.000Z", adjustment: "provider-unspecified", availability: "observed-at-fetch" } };
  const args = { symbol: "AAPL", factor: "momentum", period: 1 };
  // Independent expected values: each one-period price ratio is 2, so momentum, prior mean and percentile are 1.
  const saved = { symbol: "AAPL", source: "financial-datasets", factor: "momentum", period: 1, asOfDate: "2026-01-07", last: 1, mean: 1, percentile: 1 };
  const lines = [
    { type: "message", id: "call", parentId: null, message: { role: "assistant", content: [{ type: "toolCall", id: "factor", name: "compute_factor", arguments: args }] } },
    { type: "message", id: "result", parentId: "call", message: { role: "toolResult", toolCallId: "factor", toolName: "compute_factor", details: { ...saved, dataset: dataset.ref } } },
  ];
  return { dataset, args, saved, lines };
}

it("loads a branch snapshot independently of archive resolution or rendering", () => {
  const { lines } = fixture();
  const path = join(root, "fixture.jsonl");
  writeFileSync(path, [JSON.stringify({ type: "session", version: 3, id: "fixture" }), ...lines.map(line => JSON.stringify(line)),
    JSON.stringify({ type: "message", id: "other", parentId: null, message: { role: "user", content: "Unrelated branch" } })].join("\n"));
  const loaded = loadReportSession(path, "result")!;
  expect(loaded.lines).toEqual(lines);
  expect(loaded.provenance).toMatchObject({ scope: "branch", leafId: "result", entryIds: ["call", "result"], datasets: [] });
  rmSync(path);
  expect(loaded.lines).toEqual(lines);
  expect(loadReportSession(path)).toBeNull();
});

it("normalizes and projects supplied observations without the default archive or HTML pipeline", () => {
  const { dataset, lines } = fixture();
  const supplied = dataset.bars.toReversed().map(bar => ({ ...bar, privateNote: "DO_NOT_SHARE" }));
  const before = structuredClone(supplied);
  const report = buildResearchReport({ lines }, ref => {
    expect(ref).toEqual(dataset.ref);
    return supplied;
  });
  expect(report.datasets).toEqual([dataset]);
  expect(report.analyses[0]!.metrics.map(metric => metric.value)).toEqual([1, 1, 1]);
  expect(supplied).toEqual(before);
  expect(JSON.stringify(report.datasets)).not.toContain("DO_NOT_SHARE");
  const missing = buildResearchReport({ lines }, () => { throw new Error("Injected archive unavailable"); });
  expect(missing.analyses).toEqual([]);
  expect(missing.exclusions.unavailableInputs).toBe(1);
  expect(readdirSync(root)).toEqual(["settings.json"]);
});

it("derives and checks metrics from an explicit dataset snapshot with no transcript or renderer", () => {
  const { dataset, args, saved } = fixture();
  const before = structuredClone(dataset);
  const analysis = verifyResearchAnalysis("compute_factor", args, saved, { input: 0 }, [dataset]);
  expect(analysis).toMatchObject({ kind: "factor", datasetIndexes: [0], title: "AAPL · momentum (1)" });
  expect(analysis.metrics.map(metric => [metric.label, metric.value])).toEqual([["Latest", 1], ["Prior mean", 1], ["Prior percentile", 1]]);
  expect(() => verifyResearchAnalysis("compute_factor", args, { ...saved, last: 2 }, { input: 0 }, [dataset])).toThrow("Factor result mismatch");
  expect(dataset).toEqual(before);
  expect(readdirSync(root)).toEqual(["settings.json"]);
});

it("renders a serialized report DTO without a source session, archive or calculation call", () => {
  const { dataset } = fixture();
  const report: ResearchReport = { version: 1, bindings: [], datasets: [dataset], exclusions: { unavailableInputs: 0, unverifiedResults: 0, unsupportedResults: 0 },
    analyses: [{ kind: "factor", title: "AAPL · explicit snapshot", datasetIndexes: [0], metrics: [{ label: "Latest", value: 1, unit: "number" }], assumptions: ["Explicit fixture observations"] }] };
  const snapshot: ResearchReport = JSON.parse(JSON.stringify(report));
  const before = structuredClone(snapshot);
  expect(renderResearchResults(snapshot)).toContain("1.0000");
  const html = renderShareReport(snapshot)!;
  expect(html).toContain("AAPL · explicit snapshot");
  expect(html).toContain("2026-01-07");
  expect(html).not.toMatch(/<script|<iframe|src=["']https?:/);
  expect(snapshot).toEqual(before);
  expect(readdirSync(root)).toEqual(["settings.json"]);
});
