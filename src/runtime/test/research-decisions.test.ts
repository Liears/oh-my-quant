import { afterEach, beforeEach, expect, spyOn, test, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseHTML } from "linkedom";
import { buildResearchReport } from "../../research/input.ts";
import { renderShareReport } from "../../artifact/src/research-renderer.ts";
import { annualComparisonFixture } from "../../research/test/annual-fixture.ts";
import { loadAnnualReport, researchDecisionHash } from "../../storage/index.ts";
import { researchDecisionsTool } from "../../tools/research-decision-tool.ts";
import { annualReportTool } from "../../tools/annual-tools.ts";
import { findBuiltinTool, listBuiltinToolCapabilities } from "../../tools/registry.ts";
import type { ResearchDecisionRequest } from "../../types/research-decision.ts";
import { generateAnnualReport, listAnnualReports, restoreAnnualReport } from "../research/annual-reports.ts";
import { readResearchDecisions, recordResearchDecision } from "../research/research-decisions.ts";

// These cases write multiple locked archives before rendering and restoring reports.
setDefaultTimeout(30_000);
let inFlight: Promise<unknown> | undefined;
function owned<T extends unknown[]>(body: (...args: T) => unknown) {
  return (...args: T) => (inFlight = Promise.resolve().then(() => body(...args)));
}
let root: string, previous: string | undefined;
let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
  inFlight = undefined;
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-decisions-")); process.env.OHQUANT_DIR = root;
  network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Decision evidence must stay offline"));
});
afterEach(async () => {
  // A test deadline does not cancel storage writes. Keep their root alive until settled.
  if (inFlight) await Promise.allSettled([inFlight]);
  const calls = network.mock.calls.length;
  network.mockRestore();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected decision fixture");
  rmSync(root, { recursive: true, force: true });
  expect(calls).toBe(0);
}, 30_000);
function request(comparisonId: string, overrides: Partial<ResearchDecisionRequest> = {}): ResearchDecisionRequest {
  return { requestId: "review-2025-001", comparisonId, declaredDate: "2025-12-31", choice: "defer", rationale: "等待更多观察；本条是研究声明。", ...overrides };
}
function decisionPath(id: string) { return join(root, "research", "decisions", `${id}.json`); }
function annualRequest(comparisonId: string, decisionIds?: string[]) {
  return { comparisonId, year: 2025, valuationCutoff: "2025-12-31", ...(decisionIds ? { decisionIds } : {}) };
}

test("record/read/list bind exact evidence, preserve retry bytes and refuse conflicting request IDs", owned(async () => {
  const source = (await annualComparisonFixture()).save(), input = request(source.id);
  const saved = recordResearchDecision(input), path = decisionPath(saved.decision.id), bytes = readFileSync(path, "utf8");
  expect(saved).toMatchObject({ groupIds: ["core", "growth"], retrospective: true, evidenceAfterDeclaredDate: true,
    decision: { request: input, provenance: "explicit-tool-input" } });
  expect(recordResearchDecision({ ...input })).toEqual(saved);
  expect(readFileSync(path, "utf8")).toBe(bytes);
  expect(() => recordResearchDecision({ ...input, rationale: "changed" })).toThrow("already has different content");
  expect(readFileSync(path, "utf8")).toBe(bytes);
  expect(readResearchDecisions(saved.decision.id)).toEqual({ items: [saved], unavailable: [] });
  expect(readResearchDecisions()).toEqual({ items: [saved], unavailable: [] });
  expect(existsSync(join(root, "portfolio"))).toBe(false);
  expect(existsSync(join(root, "panel-portfolio.json"))).toBe(false);
}));

test.each([
  { declaredDate: "2025-02-29" }, { declaredDate: "9999-12-31" }, { rationale: " \n " },
  { rationale: "x".repeat(4001) }, { requestId: "../secret" }, { quantity: 10 },
])("invalid research request %j never creates a decision directory", owned(async invalid => {
  const source = (await annualComparisonFixture()).save();
  expect(() => recordResearchDecision({ ...request(source.id), ...invalid })).toThrow("Invalid research decision");
  expect(existsSync(join(root, "research", "decisions"))).toBe(false);
}));

test("cancellation, traversal and missing comparison cannot commit", owned(() => {
  const signal = AbortSignal.abort(new Error("cancel decision"));
  expect(() => recordResearchDecision(request("missing"), signal)).toThrow("cancel decision");
  expect(() => readResearchDecisions(undefined, signal)).toThrow("cancel decision");
  expect(() => readResearchDecisions("../settings")).toThrow("Invalid research decision ID");
  expect(() => recordResearchDecision(request("../settings"))).toThrow("Invalid portfolio comparison ID");
  expect(() => recordResearchDecision(request("00000000-0000-4000-8000-000000000000"))).toThrow();
  expect(existsSync(join(root, "research", "decisions"))).toBe(false);
}));

test("corrupt decision is unavailable; retry preserves the corrupt original instead of overwriting", owned(async () => {
  const source = (await annualComparisonFixture()).save(), input = request(source.id), entry = recordResearchDecision(input);
  const path = decisionPath(entry.decision.id), corrupt = JSON.stringify({ decision: { ...entry.decision, provenance: "user-approved" }, hash: entry.hash });
  writeFileSync(path, corrupt);
  expect(() => readResearchDecisions(entry.decision.id)).toThrow("integrity");
  expect(() => recordResearchDecision(input)).toThrow("integrity");
  expect(readResearchDecisions()).toMatchObject({ items: [], unavailable: [{ file: `${entry.decision.id}.json` }] });
  expect(readFileSync(path, "utf8")).toBe(corrupt);
}));

test("changed internally consistent comparison cannot replace a journal's bound revision", owned(async () => {
  const source = (await annualComparisonFixture()).save(), input = request(source.id), entry = recordResearchDecision(input);
  const bytes = readFileSync(decisionPath(entry.decision.id), "utf8");
  source.result.input.portfolioRevision = "later-selection";
  writeFileSync(join(root, "benchmark", "comparisons", "portfolios", `${source.id}.json`),
    JSON.stringify({ artifact: source, hash: createHash("sha256").update(JSON.stringify(source)).digest("hex") }));
  expect(() => readResearchDecisions(entry.decision.id)).toThrow("comparison binding changed");
  expect(() => recordResearchDecision(input)).toThrow("already has different content");
  expect(readFileSync(decisionPath(entry.decision.id), "utf8")).toBe(bytes);
}));

test("missing original bars invalidates the journal and annual restore while preserving report bytes", owned(async () => {
  const source = (await annualComparisonFixture()).save(), entry = recordResearchDecision(request(source.id));
  const report = generateAnnualReport(annualRequest(source.id, [entry.decision.id])), html = readFileSync(report.path, "utf8");
  const ref = source.result.input.prices[0]!.dataset!;
  unlinkSync(join(root, "data", ref.source, ref.symbol, "revisions", `${ref.revision}.json`));
  expect(() => readResearchDecisions(entry.decision.id)).toThrow("unavailable");
  expect(() => restoreAnnualReport(report.id)).toThrow("unavailable");
  expect(readResearchDecisions().unavailable).toHaveLength(1);
  expect(listAnnualReports().unavailable).toHaveLength(1);
  expect(readFileSync(report.path, "utf8")).toBe(html);
}));

test("annual selection is explicit, date ordered and escaped; later journal append cannot alter a report", owned(async () => {
  const source = (await annualComparisonFixture()).save();
  const later = recordResearchDecision(request(source.id, { rationale: "等待 <script>bad()</script> & 后续证据" }));
  const earlier = recordResearchDecision(request(source.id, { requestId: "review-2025-002", declaredDate: "2025-06-30", choice: "retain" }));
  const unselected = generateAnnualReport(annualRequest(source.id));
  expect(unselected.strategyHistory).toBe("not-connected");
  expect(parseHTML(readFileSync(unselected.path, "utf8")).document.querySelector("#decisions")).toBeNull();
  const report = generateAnnualReport(annualRequest(source.id, [later.decision.id, earlier.decision.id]));
  const html = readFileSync(report.path, "utf8"), { document } = parseHTML(html);
  expect(report).toMatchObject({ accountPerformance: "not-connected", strategyHistory: "recorded-research-decisions",
    decisionHashes: [{ id: earlier.decision.id, hash: earlier.hash }, { id: later.decision.id, hash: later.hash }] });
  const section = document.querySelector('[aria-labelledby="decisions"]')!;
  expect([...section.querySelectorAll("h3")].map(item => item.textContent)).toEqual(["2025-06-30 · retain", "2025-12-31 · defer"]);
  expect(section.textContent).toContain("仅列本次显式选取的记录");
  expect(section.textContent).toContain("补录声明日期");
  expect(section.textContent).toContain("晚于声明日期");
  expect(section.textContent).toContain("等待 <script>bad()</script> & 后续证据");
  expect(document.querySelectorAll("script,iframe,img,link")).toHaveLength(0);
  recordResearchDecision(request(source.id, { requestId: "review-2025-003", rationale: "后续追加不应进入原报告" }));
  writeFileSync(report.path, "edited preview");
  restoreAnnualReport(report.id);
  expect(readFileSync(report.path, "utf8")).toBe(html);
  expect(readResearchDecisions().items).toHaveLength(3);
}));

test("opt-in recorded-year selection freezes every eligible local decision, excluding other groups and later evidence", owned(async () => {
  const source = (await annualComparisonFixture()).save();
  const early = recordResearchDecision(request(source.id, { requestId: "review-2025-early", declaredDate: "2025-06-30", choice: "retain" }));
  const late = recordResearchDecision(request(source.id, { requestId: "review-2025-late", declaredDate: "2025-12-31" }));
  recordResearchDecision(request(source.id, { requestId: "review-2024-old", declaredDate: "2024-12-31" }));
  const other = await annualComparisonFixture(); other.input.groups[0]!.id = "other"; other.input.request!.groups[0] = "other";
  recordResearchDecision(request(other.save().id, { requestId: "review-2025-other" }));
  const report = generateAnnualReport(annualRequest(source.id), undefined, "all-recorded");
  const html = readFileSync(report.path, "utf8");
  expect(report.request).toMatchObject({ decisionSelection: "all-recorded-at-generation", decisionIds: [early.decision.id, late.decision.id] });
  expect(report.decisionHashes.map(entry => entry.id)).toEqual([early.decision.id, late.decision.id]);
  expect(html).toContain("生成时本地档案中可核验的匹配研究记录");
  expect(html).toContain("不证明全年真实决策完整");
  recordResearchDecision(request(source.id, { requestId: "review-2025-after", rationale: "生成后新增，不修改旧报告" }));
  writeFileSync(report.path, "changed preview");
  restoreAnnualReport(report.id);
  expect(readFileSync(report.path, "utf8")).toBe(html);
  expect(loadAnnualReport(report.id).request.decisionIds).toEqual([early.decision.id, late.decision.id]);
}));

test("recorded-year selection fails closed on a corrupt journal, empty match or manual-ID conflict", owned(async () => {
  const source = (await annualComparisonFixture()).save();
  expect(() => generateAnnualReport(annualRequest(source.id), undefined, "all-recorded")).toThrow("No eligible recorded");
  const entry = recordResearchDecision(request(source.id));
  expect(() => generateAnnualReport({ ...annualRequest(source.id, [entry.decision.id]), decisionSelection: "all-recorded-at-generation" })).toThrow("derived during generation");
  expect(() => generateAnnualReport(annualRequest(source.id, [entry.decision.id]), undefined, "all-recorded")).toThrow("either");
  writeFileSync(decisionPath(entry.decision.id), "corrupt original");
  expect(() => generateAnnualReport(annualRequest(source.id), undefined, "all-recorded")).toThrow("unavailable");
  expect(listAnnualReports().items).toHaveLength(0);
  expect(readFileSync(decisionPath(entry.decision.id), "utf8")).toBe("corrupt original");
}));

test("recorded-year YTD excludes declarations backed by comparisons extending beyond its cutoff", owned(async () => {
  const full = (await annualComparisonFixture()).save();
  recordResearchDecision(request(full.id, { requestId: "review-ytd-full", declaredDate: "2025-06-30" }));
  const ytd = (await annualComparisonFixture(2025, "2025-09-30")).save();
  const eligible = recordResearchDecision(request(ytd.id, { requestId: "review-ytd-local", declaredDate: "2025-06-30" }));
  const report = generateAnnualReport({ comparisonId: ytd.id, year: 2025, valuationCutoff: "2025-09-30" }, undefined, "all-recorded");
  expect(report.decisionHashes.map(item => item.id)).toEqual([eligible.decision.id]);
  expect(readFileSync(report.path, "utf8")).toContain("年内截至日研究报告");
}));

test("recorded-year selection rejects more than the bounded report can display and is callable from the Agent tool", owned(async () => {
  const source = (await annualComparisonFixture()).save();
  for (let index = 0; index < 21; index++) recordResearchDecision(request(source.id, { requestId: `review-2025-${index.toString().padStart(3, "0")}` }));
  expect(() => generateAnnualReport(annualRequest(source.id), undefined, "all-recorded")).toThrow("20");
  expect(listAnnualReports().items).toHaveLength(0);
  const second = (await annualComparisonFixture(2024)).save();
  recordResearchDecision(request(second.id, { requestId: "review-2024-tool", declaredDate: "2024-12-31" }));
  const result = await annualReportTool.execute("annual-all", { comparison_id: second.id, year: 2024, valuation_cutoff: "2024-12-31", decision_scope: "all-recorded" });
  const details = result.details as ReturnType<typeof generateAnnualReport>;
  expect(details.request).toMatchObject({ decisionSelection: "all-recorded-at-generation", decisionIds: [createHash("sha256").update("review-2024-tool").digest("hex")] });
  expect(result.content.filter(item => item.type === "text").map(item => item.text).join("\n")).toContain("all-recorded-at-generation");
}));

test("annual rejects duplicated, empty, over-limit and out-of-year decision selections", owned(async () => {
  const source = (await annualComparisonFixture()).save();
  const entry = recordResearchDecision(request(source.id));
  for (const ids of [[], [entry.decision.id, entry.decision.id], Array.from({ length: 21 }, (_, i) => i.toString(16).padStart(64, "0"))]) {
    expect(() => generateAnnualReport(annualRequest(source.id, ids))).toThrow("1 to 20 unique");
  }
  const old = recordResearchDecision(request(source.id, { requestId: "review-2024-001", declaredDate: "2024-12-31" }));
  expect(() => generateAnnualReport(annualRequest(source.id, [old.decision.id]))).toThrow("year/cutoff");
  expect(listAnnualReports().items).toHaveLength(0);
}));

test("annual refuses unrelated groups and evidence beyond the cutoff", owned(async () => {
  const source = (await annualComparisonFixture()).save(), unrelated = await annualComparisonFixture();
  unrelated.input.groups[0].id = "unrelated"; unrelated.input.request!.groups[0] = "unrelated";
  const entry = recordResearchDecision(request(unrelated.save().id));
  expect(() => generateAnnualReport(annualRequest(source.id, [entry.decision.id]))).toThrow("ordered group IDs");
  const annual = recordResearchDecision(request(source.id, { requestId: "review-2025-002", declaredDate: "2025-09-30" }));
  const ytd = (await annualComparisonFixture(2025, "2025-09-30")).save();
  expect(() => generateAnnualReport({ ...annualRequest(ytd.id, [annual.decision.id]), valuationCutoff: "2025-09-30" })).toThrow("year/cutoff");
}));

test("changed decision with a recomputed envelope hash still invalidates the annual binding", owned(async () => {
  const source = (await annualComparisonFixture()).save(), entry = recordResearchDecision(request(source.id));
  const report = generateAnnualReport(annualRequest(source.id, [entry.decision.id])), html = readFileSync(report.path, "utf8");
  entry.decision.request.rationale = "rewritten rationale";
  writeFileSync(decisionPath(entry.decision.id), JSON.stringify({ decision: entry.decision, hash: researchDecisionHash(entry.decision) }));
  expect(readResearchDecisions().items).toHaveLength(1);
  expect(() => restoreAnnualReport(report.id)).toThrow("evidence binding changed");
  expect(listAnnualReports().unavailable).toHaveLength(1);
  expect(readFileSync(report.path, "utf8")).toBe(html);
}));

test("registered tool exposes rationale and timing to the model and produces selectable annual IDs", owned(async () => {
  const source = (await annualComparisonFixture()).save(), input = request(source.id);
  expect(Object.is(findBuiltinTool("research_decisions"), researchDecisionsTool)).toBe(true);
  expect(listBuiltinToolCapabilities().find(tool => tool.name === "research_decisions")?.requirements).toMatchObject({ capability: "annual-research", effects: ["local-read", "research-storage"] });
  const result = await researchDecisionsTool.execute("record", { action: "record", decision: input });
  const entry = result.details as ReturnType<typeof recordResearchDecision>;
  const read = await researchDecisionsTool.execute("read", { action: "read", id: entry.decision.id });
  const content = JSON.stringify(read.content);
  for (const value of [input.rationale, entry.hash, entry.decision.recordedAt, "retrospective", "evidenceAfterDeclaredDate"]) expect(content).toContain(value);
  const report = await annualReportTool.execute("annual", { comparison_id: source.id, year: 2025, valuation_cutoff: "2025-12-31", decision_ids: [entry.decision.id] });
  expect(report.details).toMatchObject({ strategyHistory: "recorded-research-decisions", decisionHashes: [{ id: entry.decision.id, hash: entry.hash }] });
  const publicResearch = buildResearchReport({ lines: [
    { id: "comparison-call", type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "comparison", name: "portfolio_comparisons", arguments: { id: source.id } }] } },
    { id: "comparison-result", type: "message", message: { role: "toolResult", toolCallId: "comparison", toolName: "portfolio_comparisons", details: source } },
    { id: "decision-call", type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "record", name: "research_decisions", arguments: { action: "record", decision: input } }] } },
    { id: "decision-result", type: "message", message: { role: "toolResult", toolCallId: "record", toolName: "research_decisions", ...result } },
  ] });
  expect(publicResearch.analyses).toHaveLength(1);
  const share = renderShareReport(publicResearch)!;
  expect(share).toContain("AAPL");
  for (const value of [input.rationale, input.requestId, entry.decision.id, entry.hash]) expect(share).not.toContain(value);
  await expect(researchDecisionsTool.execute("bad", { action: "read" })).rejects.toThrow("read with only id");
  await expect(researchDecisionsTool.execute("bad", { action: "list", id: entry.decision.id })).rejects.toThrow("list without arguments");
  await expect(researchDecisionsTool.execute("bad", { action: "record", id: entry.decision.id, decision: input })).rejects.toThrow("record requires only decision");
}));
