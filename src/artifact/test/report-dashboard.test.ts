import { afterEach, beforeEach, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { saveBars, saveBenchmarkResult, subscribeFileEvents } from "../../storage/index.ts";
import { scoreBenchmarkTool, showDashboardTool } from "../../tools/benchmark-tools.ts";
import { buildResearchReport } from "../../research/input.ts";
import { loadReportSession } from "../src/report-input.ts";
import { generateArtifact } from "../src/generator.ts";
import { renderShareReport } from "../src/research-renderer.ts";
import type { DatasetRef } from "../../types/data.ts";
import type { BenchmarkResultSnapshot } from "../../types/benchmark-data.ts";

let root: string, previous: string | undefined;
const PRIVATE = "PRIVATE_DASHBOARD_2198";
beforeEach(async () => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "ohq-dashboard-")); process.env.OHQUANT_DIR = root;
  for (const [symbol, offset] of [["000004.SZ", 0], ["000300.SH", 10]] as const) {
    await saveBars(symbol, "akshare", Array.from({ length: 120 }, (_, i) => {
      const close = 100 + offset + i * 0.1 + Math.sin(i / 5) * (offset + 1);
      return { date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 100, amount: 1000 };
    }), "1900-01-01");
  }
  for (const fast of [2, 3, 5]) await scoreBenchmarkTool.execute(`score-${fast}`, { symbol: "000004.SZ", fast, slow: 10, cash: 9876543.21, label: `${PRIVATE}_${fast}` });
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected dashboard fixture directory");
  rmSync(root, { recursive: true, force: true });
});

function transcript(details: unknown, args: Record<string, unknown> = { sort_by: "cagr" }): string {
  const path = join(root, "dashboard.jsonl");
  writeFileSync(path, [
    { type: "session", version: 3, id: PRIVATE, cwd: root },
    { type: "message", id: "u", parentId: null, message: { role: "user", content: PRIVATE } },
    { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [{ type: "toolCall", id: "d", name: "show_dashboard", arguments: args }] } },
    { type: "message", id: "t", parentId: "a", message: { role: "toolResult", toolCallId: "d", toolName: "show_dashboard", content: [{ type: "text", text: PRIVATE }], details } },
  ].map(value => JSON.stringify(value)).join("\n") + "\n");
  return path;
}
function recalculateHash(snapshot: BenchmarkResultSnapshot): void { snapshot.revision = createHash("sha256").update(JSON.stringify(snapshot.result)).digest("hex"); }

it("replays a standalone dashboard from actual saved evaluations without exposing labels or capital", async () => {
  const result = await showDashboardTool.execute("d", { sort_by: "cagr" });
  const path = transcript(result.details), report = buildResearchReport(loadReportSession(path)!);
  expect(report.analyses.map(analysis => analysis.kind)).toEqual(["dashboard"]);
  expect(report.analyses[0]!.ranking).toHaveLength(3);
  expect(report.exclusions).toEqual({ unavailableInputs: 0, unverifiedResults: 0, unsupportedResults: 0 });
  const html = renderShareReport(report)!;
  expect(html).toContain("data-research-ranking");
  expect(html).toContain("000004.SZ vs 000300.SH");
  expect(/PRIVATE_DASHBOARD|9876543\.21|"filename"|"parameters"|"cash"|<script/.test(html)).toBe(false);
  const generated = generateArtifact({ sessionPath: path, leafId: "t" })!;
  expect(generated.provenance.datasets).toHaveLength(6);
  expect(generated.provenance.datasets.every(dataset => dataset.verified)).toBe(true);
});

it("checks the full captured scores, inputs, order and summary even when hashes are recomputed", async () => {
  const original = (await showDashboardTool.execute("d", { sort_by: "cagr" })).details as Record<string, unknown>;
  for (const field of ["score", "summary", "ranking", "cost", "source", "dates", "cash", "duplicate", "sort", "price-basis"] as const) {
    const changed = structuredClone(original), snapshots = changed.snapshots as BenchmarkResultSnapshot[], snapshot = snapshots[0]!;
    if (field === "score") snapshot.result.totalScore = Number(snapshot.result.totalScore) + 1;
    if (field === "summary") (changed.summary as Record<string, unknown>).medianScore = -5;
    if (field === "ranking") (changed.rows as unknown[]).reverse();
    if (field === "cost") (snapshot.result.parameters as Record<string, unknown>).commission = 0.01;
    if (field === "source") ((snapshot.result.source as Record<string, unknown>).strategy as Record<string, unknown>).fetcher = "tushare";
    if (field === "dates") (snapshot.result.dates as string[]).shift();
    if (field === "cash") (snapshot.result.parameters as Record<string, unknown>).cash = 2;
    if (field === "price-basis") (snapshot.result.assumptions as Record<string, unknown>).priceBasis = "fx-converted";
    if (field === "duplicate") snapshots.push(structuredClone(snapshot));
    if (field === "sort") changed.sortBy = "sharpe";
    if (field !== "cash") recalculateHash(snapshot);
    const report = buildResearchReport(loadReportSession(transcript(changed))!);
    expect(report.analyses).toHaveLength(0);
    expect(report.exclusions.unverifiedResults).toBe(1);
  }
});

it("does not rescan later results or corrected prices, and fails closed when a referenced revision is lost", async () => {
  const details = (await showDashboardTool.execute("d", { sort_by: "cagr" })).details as { snapshots: BenchmarkResultSnapshot[] };
  const path = transcript(details), before = renderShareReport(buildResearchReport(loadReportSession(path)!));
  const directory = join(root, "benchmark", "results");
  for (const file of readdirSync(directory)) writeFileSync(join(directory, file), "modified after dashboard");
  expect(renderShareReport(buildResearchReport(loadReportSession(path)!))).toBe(before);
  const ref = (details.snapshots[0]!.result.datasets as { strategy: DatasetRef }).strategy;
  rmSync(join(root, "data", ref.source, ref.symbol, "revisions", `${ref.revision}.json`));
  const lost = buildResearchReport(loadReportSession(path)!);
  expect(lost.analyses).toHaveLength(0);
  expect(lost.exclusions.unavailableInputs).toBeGreaterThan(0);
  expect(lost.exclusions.unverifiedResults).toBe(1);
});

it("keeps legacy evaluations readable but refuses to claim their missing replay inputs are verified", async () => {
  const details = (await showDashboardTool.execute("d", { sort_by: "cagr" })).details as { snapshots: BenchmarkResultSnapshot[] };
  const legacy = details.snapshots[0]!;
  legacy.result.methodVersion = 2; delete legacy.result.parameters; recalculateHash(legacy);
  saveBenchmarkResult(legacy.filename, legacy.result);
  const current = await showDashboardTool.execute("d", { sort_by: "cagr" });
  expect(current.details).toMatchObject({ summary: { totalEvals: 3 } });
  const report = buildResearchReport(loadReportSession(transcript(current.details))!);
  expect(report.analyses).toHaveLength(0);
  expect(report.exclusions.unsupportedResults).toBe(1);
});

it("rederives the price basis for earlier replayable scores without a saved basis field", async () => {
  const changed = structuredClone((await showDashboardTool.execute("d", { sort_by: "cagr" })).details) as { snapshots: BenchmarkResultSnapshot[] };
  const legacy = changed.snapshots[0]!;
  delete (legacy.result.assumptions as Record<string, unknown>).priceBasis;
  recalculateHash(legacy);
  const report = buildResearchReport(loadReportSession(transcript(changed))!);
  expect(report.analyses.map(analysis => analysis.kind)).toEqual(["dashboard"]);
  expect(report.analyses[0]!.assumptions).toContainEqual(expect.stringContaining("without FX conversion"));
});

it("reports unreadable and invalid records without deleting them or treating them as zero-score runs", async () => {
  const directory = join(root, "benchmark", "results");
  writeFileSync(join(directory, "broken.json"), "{broken");
  writeFileSync(join(directory, "null.json"), "null");
  writeFileSync(join(directory, "empty.json"), "{}");
  const result = await showDashboardTool.execute("d", { sort_by: "cagr" });
  expect(result.details).toMatchObject({ unavailableFiles: 2, invalidResults: 1, summary: { totalEvals: 3 } });
  expect(readFileSync(join(directory, "broken.json"), "utf8")).toBe("{broken");
  expect(buildResearchReport(loadReportSession(transcript(result.details))!).analyses).toHaveLength(1);
});

it("does not load forged dataset references from scores excluded by the dashboard", async () => {
  const initial = (await showDashboardTool.execute("d", { sort_by: "cagr" })).details as { snapshots: BenchmarkResultSnapshot[] };
  const benchmark = (initial.snapshots[0]!.result.datasets as { benchmark: DatasetRef }).benchmark;
  saveBenchmarkResult("excluded.json", { strategy: "excluded", totalScore: 999,
    datasets: { benchmark: { ...benchmark, revision: "0".repeat(64) } } });
  const result = await showDashboardTool.execute("d", { sort_by: "cagr" });
  expect(result.details).toMatchObject({ invalidResults: 1, summary: { totalEvals: 3 } });
  const report = buildResearchReport(loadReportSession(transcript(result.details))!);
  expect(report.analyses.map(analysis => analysis.kind)).toEqual(["dashboard"]);
  expect(report.exclusions).toEqual({ unavailableInputs: 0, unverifiedResults: 0, unsupportedResults: 0 });
});

it("rejects cancellation during the file scan and before any new scan", async () => {
  const controller = new AbortController(); let reads = 0;
  const unsubscribe = subscribeFileEvents(event => {
    if (event.detail === "benchmark result") { reads++; controller.abort(new Error("cancel dashboard scan")); }
  });
  try {
    await expect(showDashboardTool.execute("d", {}, controller.signal)).rejects.toThrow("cancel dashboard scan");
    expect(reads).toBe(1);
    await expect(showDashboardTool.execute("d", {}, controller.signal)).rejects.toThrow("cancel dashboard scan");
    expect(reads).toBe(1);
  } finally { unsubscribe(); }
});

it("yields to an external cancellation during a large directory scan", async () => {
  const directory = join(root, "benchmark", "results");
  for (let i = 0; i < 65; i++) writeFileSync(join(directory, `large-${i}.json`), JSON.stringify({ strategy: `s${i}`, totalScore: i }));
  const controller = new AbortController(); let reads = 0;
  const unsubscribe = subscribeFileEvents(event => { if (event.detail === "benchmark result") reads++; });
  const timer = setImmediate(() => controller.abort(new Error("external cancel")));
  try {
    await expect(showDashboardTool.execute("d", {}, controller.signal)).rejects.toThrow("external cancel");
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(32);
  } finally { clearImmediate(timer); unsubscribe(); }
});
