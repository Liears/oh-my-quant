import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseHTML } from "linkedom";
import { annualComparisonFixture as fixture } from "../../research/test/annual-fixture.ts";
import { verifyAnnualResearch } from "../../research/annual.ts";
import { projectResearchState } from "../../research/state.ts";
import { archiveFundNav, loadAnnualReport, loadDataset, saveAnnualReport, saveBars } from "../../storage/index.ts";
import { annualReportTool, annualReportsTool } from "../../tools/annual-tools.ts";
import { findBuiltinTool, listBuiltinToolCapabilities } from "../../tools/registry.ts";
import type { Bar } from "../../types/data.ts";
import type { AnnualReportArtifact } from "../../types/annual-report.ts";
import type { PortfolioComparisonArtifact } from "../../types/portfolio-comparison.ts";
import { generateAnnualReport, listAnnualReports, restoreAnnualReport } from "../research/annual-reports.ts";
import { inspectToolReadiness } from "../data/tool-readiness.ts";
import { loadSettings } from "../../storage/index.ts";

let root: string, previous: string | undefined;
let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-annual-"));
  process.env.OHQUANT_DIR = root;
  network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Annual reports must work offline"));
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); network.mockRestore();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected test directory");
  rmSync(root, { recursive: true, force: true });
});

function bars(dates: string[], values: number[]): Bar[] {
  return dates.map((date, index) => ({ date, open: values[index]!, high: values[index]!, low: values[index]!, close: values[index]!, volume: 100, amount: 1000 }));
}

function request(artifact: PortfolioComparisonArtifact) {
  return { comparisonId: artifact.id, year: Number(artifact.result.input.start.slice(0, 4)), valuationCutoff: artifact.result.input.end };
}

function rewriteComparison(artifact: PortfolioComparisonArtifact) {
  const path = join(root, "benchmark", "comparisons", "portfolios", `${artifact.id}.json`);
  writeFileSync(path, JSON.stringify({ artifact, hash: createHash("sha256").update(JSON.stringify(artifact)).digest("hex") }));
  return path;
}

test("annual numeric output uses real archived closes, exact study revision and offline escaped HTML", async () => {
  const source = (await fixture()).save(), result = generateAnnualReport(request(source));
  const research = verifyAnnualResearch(request(source));
  expect(research.period).toBe("calendar-year");
  expect(research.source.result.groups[0].totalReturn).toBeCloseTo(0.2, 12);
  expect(research.source.result.groups[0].maxDrawdown).toBeCloseTo(90 / 110 - 1, 12);
  expect(research.source.result.groups[0].excessReturn).toBeCloseTo(0.05, 12);
  expect(research.source.result.benchmark.totalReturn).toBeCloseTo(0.15, 12);
  const html = readFileSync(result.path, "utf8"), { document } = parseHTML(html);
  expect(document.querySelectorAll("script,iframe,img,link")).toHaveLength(0);
  expect(document.querySelectorAll("[data-comparison-series]")).toHaveLength(3);
  expect(document.querySelectorAll("[data-comparison-nav] tbody tr")).toHaveLength(4);
  expect(document.querySelector("h1")?.textContent).toBe("2025 年度研究报告");
  expect(document.querySelector("[data-comparison-metrics]")?.textContent).toContain("20.00%");
  expect(html).toContain("selected-historical-revision"); expect(html).toContain(source.id);
  expect(html).toContain("Core &lt;script&gt;bad()&lt;/script&gt;");
  expect(html).toContain("真实账户业绩未接入"); expect(html).toContain("策略变更记录未接入");
  expect(html).toContain("2025-01-02 — 2025-12-31");
  expect(html).toContain("不证明这些数据在历史当时已可得");
  expect(html).toContain("Content-Security-Policy");
  expect(result).toMatchObject({ accountPerformance: "not-connected", strategyHistory: "not-connected" });
  expect(existsSync(join(root, "panel-portfolio.json"))).toBe(false);
  expect(existsSync(join(root, "portfolio"))).toBe(false);
});

test("partial year is labelled YTD and cannot be renamed a full year", async () => {
  const source = (await fixture(2025, "2025-09-30")).save();
  const result = generateAnnualReport(request(source));
  expect(readFileSync(result.path, "utf8")).toContain("2025 年内截至日研究报告");
  expect(() => generateAnnualReport({ ...request(source), valuationCutoff: "2025-12-31" })).toThrow("Comparison window must be");
});

test.each(["2025-02-29", "2024-12-31", "9999-12-31", "2025-13-01"])("rejects invalid, wrong-year or future cutoff %s before publication", async cutoff => {
  const source = (await fixture()).save();
  expect(() => generateAnnualReport({ ...request(source), valuationCutoff: cutoff })).toThrow("Annual cutoff");
  expect(listAnnualReports().items).toHaveLength(0);
});

test("a mid-year comparison cannot masquerade as an annual request", async () => {
  const data = await fixture(); data.input.start = "2025-03-01"; data.input.request!.start = data.input.start;
  expect(() => generateAnnualReport(request(data.save()))).toThrow("Comparison window must be");
});

test("missing original request or dataset references cannot produce a report", async () => {
  const data = await fixture(); delete data.input.request;
  expect(() => generateAnnualReport(request(data.save()))).toThrow("original request binding");
  const other = await fixture(); delete other.input.prices[0]!.dataset;
  expect(() => generateAnnualReport(request(other.save()))).toThrow("archived comparison price");
  expect(listAnnualReports().items).toHaveLength(0);
});

test("recomputed arithmetic and recorded prices must match even after the outer hash is updated", async () => {
  const source = (await fixture()).save();
  source.result.groups[0].totalReturn = 8;
  rewriteComparison(source);
  expect(() => generateAnnualReport(request(source))).toThrow("arithmetic mismatch");
  source.result.input.prices[0]!.points[0]!.price = 1;
  rewriteComparison(source);
  expect(() => generateAnnualReport(request(source))).toThrow("archived observations");
});

test("restore rejects changed study binding even if new inputs are internally consistent", async () => {
  const source = (await fixture()).save(), result = generateAnnualReport(request(source)), before = readFileSync(result.path, "utf8");
  source.result.input.portfolioRevision = "replaced";
  rewriteComparison(source);
  expect(() => restoreAnnualReport(result.id)).toThrow("binding changed");
  expect(readFileSync(result.path, "utf8")).toBe(before);
  expect(listAnnualReports().unavailable).toHaveLength(1);
});

test("missing archived dataset fails generation and restore, preserves files and is listed as unavailable", async () => {
  const source = (await fixture()).save(), result = generateAnnualReport(request(source));
  const ref = source.result.input.prices[0]!.dataset!;
  unlinkSync(join(root, "data", ref.source, ref.symbol, "revisions", `${ref.revision}.json`));
  const original = readFileSync(result.path, "utf8");
  expect(() => restoreAnnualReport(result.id)).toThrow("unavailable");
  expect(() => generateAnnualReport(request(source))).toThrow("unavailable");
  expect(readFileSync(result.path, "utf8")).toBe(original);
  expect(listAnnualReports()).toMatchObject({ items: [], unavailable: [{ file: `${result.id}.json` }] });
});

test("restores original HTML after preview edits and ignores newer market cache and portfolio preferences", async () => {
  const source = (await fixture()).save(), result = generateAnnualReport(request(source)), original = readFileSync(result.path, "utf8");
  writeFileSync(result.path, "altered preview");
  writeFileSync(join(root, "panel-portfolio.json"), "invalid current preferences must not be read");
  await saveBars("AAPL", "financial-datasets", bars(["2025-12-31"], [999]), "2025-12-31", "2025-12-31");
  expect(restoreAnnualReport(result.id).path).toBe(result.path);
  expect(readFileSync(result.path, "utf8")).toBe(original);
  expect(listAnnualReports().items).toHaveLength(1);
});

test("annual envelope tampering is detected and corrupt originals remain on disk", async () => {
  const result = generateAnnualReport(request((await fixture()).save())), path = join(root, "reports", "annual", `${result.id}.json`);
  const envelope = JSON.parse(readFileSync(path, "utf8")) as { artifact: AnnualReportArtifact; hash: string };
  envelope.artifact.html += "altered";
  const changed = JSON.stringify(envelope); writeFileSync(path, changed);
  expect(() => restoreAnnualReport(result.id)).toThrow("integrity");
  expect(listAnnualReports().unavailable).toHaveLength(1);
  expect(readFileSync(path, "utf8")).toBe(changed);
});

test("restoring an older HTML returns current interpretation without rewriting the immutable report", async () => {
  const source = (await fixture()).save(), current = loadAnnualReport(generateAnnualReport(request(source)).id);
  // Model a saved template predating the interval and sample-risk explanations.
  const html = current.html.replace(/<li>Observed intervals span.*?<\/li>/g, "").replace(/<li>Sharpe (?:uses|=).*?<\/li>/g, "");
  const older = saveAnnualReport({ request: current.request, createdAt: current.createdAt, comparisonHash: current.comparisonHash, perspectiveVersion: 1, html });
  const path = join(root, "reports", "annual", `${older.id}.json`), bytes = readFileSync(path, "utf8");
  expect(html).not.toContain("descriptive sample estimates");
  const result = await annualReportsTool.execute("restore", { id: older.id });
  const details = result.details as ReturnType<typeof restoreAnnualReport>;
  expect(details.interpretationNotes.join("\n")).toContain("88 to 184 calendar days");
  expect(details.interpretationNotes.join("\n")).toContain("Zero observed drawdown does not determine or cause a high Sharpe");
  expect(result.content.filter(item => item.type === "text").map(item => item.text).join("\n")).toContain("descriptive sample estimates");
  expect(readFileSync(details.path, "utf8")).toBe(html);
  expect(readFileSync(path, "utf8")).toBe(bytes);
  expect(loadAnnualReport(older.id)).toEqual(older);
});

test("reports are immutable versions; traversal and cancellation never publish", async () => {
  const source = (await fixture()).save(), first = generateAnnualReport(request(source)), second = generateAnnualReport(request(source));
  expect(first.id).not.toBe(second.id); expect(listAnnualReports().items).toHaveLength(2);
  expect(() => restoreAnnualReport("../settings")).toThrow("Invalid annual report ID");
  expect(() => generateAnnualReport({ ...request(source), comparisonId: "../settings" })).toThrow("Invalid portfolio comparison ID");
  const signal = AbortSignal.abort(new Error("cancel annual"));
  expect(() => generateAnnualReport(request(source), signal)).toThrow("cancel annual");
  expect(() => restoreAnnualReport(first.id, signal)).toThrow("cancel annual");
  expect(() => listAnnualReports(signal)).toThrow("cancel annual");
  expect(listAnnualReports().items).toHaveLength(2);
});

test("explicit member exclusion and missing common dates are shown, never filled with zero", async () => {
  const data = await fixture();
  data.input.groups[0].members.push("NVDA"); data.input.request!.currencies.NVDA = "USD";
  data.input.missingMembers = "exclude"; data.input.request!.missingMembers = "exclude";
  data.input.prices.push({ symbol: "NVDA", currency: "USD", source: "financial-datasets", origin: "fixture", observedAt: "2026-01-01T00:00:00.000Z", points: [] });
  const price = data.input.prices[1]!; price.points.splice(1, 1);
  const dataset = (await saveBars(price.symbol, price.source, bars(price.points.map(point => point.date), price.points.map(point => point.price)), data.input.start, data.input.end))!;
  price.dataset = dataset; price.observedAt = dataset.snapshotAt;
  const result = generateAnnualReport(request(data.save())), html = readFileSync(result.path, "utf8");
  expect(html).toContain("已排除成员 1 个"); expect(html).toContain("丢弃 1 个候选日期");
  expect(html).toContain("NVDA"); expect(html).toContain("2025-03-31");
  expect(parseHTML(html).document.querySelectorAll("[data-comparison-nav] tbody tr")).toHaveLength(3);
});

test("fund NAV archive and same-date FX participate in verification and return calculations", async () => {
  const data = await fixture(), price = data.input.prices[0]!, dates = price.points.map(point => point.date);
  const dataset = (await archiveFundNav("000001.OF", dates.map((navDate, index) => ({ fundCode: "000001", navDate, unitNav: [1, 1.1, 0.9, 1.2][index]!, accumulatedNav: null, dailyReturnPct: null, isOpenDay: true, source: "akshare" })), "fund_open_fund_info_em", "2026-01-02T00:00:00.000Z"))!;
  price.symbol = "000001.OF"; price.currency = "CNY"; price.dataset = dataset; price.source = "akshare"; price.observedAt = dataset.snapshotAt;
  price.points = dates.map((date, index) => ({ date, price: [1, 1.1, 0.9, 1.2][index]! }));
  data.input.groups[0].members = [price.symbol]; delete data.input.request!.currencies.AAPL; data.input.request!.currencies[price.symbol] = "CNY";
  data.input.fx = { baseCurrency: "USD", source: "frankfurter-v2/ecb", observedAt: "2026-01-02T00:00:00.000Z", points: dates.map(date => ({ date, currency: "CNY", rate: 0.14 })) };
  const source = data.save(), result = generateAnnualReport(request(source));
  expect(source.result.groups[0].totalReturn).toBeCloseTo(0.2, 12);
  expect(readFileSync(result.path, "utf8")).toContain("000001.OF");
  expect(readFileSync(result.path, "utf8")).toContain("frankfurter-v2/ecb");
  expect(restoreAnnualReport(result.id).id).toBe(result.id);
  unlinkSync(join(root, "data", "akshare", price.symbol, "nav-revisions", `${dataset.revision}.json`));
  expect(() => restoreAnnualReport(result.id)).toThrow("unavailable");
});

test("historical viewpoints have primary links and separate applications, excluding future publication", async () => {
  const source = (await fixture(2013)).save(), result = generateAnnualReport(request(source));
  const html = readFileSync(result.path, "utf8");
  expect(html).toContain("Howard Marks"); expect(html).not.toContain("Warren E. Buffett");
  expect(html).toContain("oaktreecapital.com/docs/default-source/memos/");
  expect(html).toContain("原文观点摘要"); expect(html).toContain("WhyJ 研究应用");
  const later = generateAnnualReport(request((await fixture()).save()));
  expect(readFileSync(later.path, "utf8")).toContain("berkshirehathaway.com/letters/2013ltr.pdf");
});

test("default Agent tools generate/list/restore and recovery records the link without inventing verified performance", async () => {
  const source = (await fixture()).save(), args = { comparison_id: source.id, year: 2025, valuation_cutoff: "2025-12-31" };
  expect(Object.is(findBuiltinTool("annual_report"), annualReportTool)).toBe(true);
  expect(Object.is(findBuiltinTool("annual_reports"), annualReportsTool)).toBe(true);
  const result = await annualReportTool.execute("annual", args);
  const details = result.details as ReturnType<typeof generateAnnualReport>;
  const listed = await annualReportsTool.execute("list", {});
  expect(listed.details).toMatchObject({ items: [{ id: details.id }], unavailable: [] });
  const restored = await annualReportsTool.execute("restore", { id: details.id });
  expect(restored.details).toMatchObject({ path: details.path, accountPerformance: "not-connected" });
  const state = projectResearchState([
    { id: "call", type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "annual", name: "annual_report", arguments: args }] } },
    { id: "result", type: "message", message: { role: "toolResult", toolCallId: "annual", toolName: "annual_report", ...result } },
  ], ["annual_report", "annual_reports"]);
  expect(state.operations[0]).toMatchObject({ status: "recorded", recordedScope: { id: details.id, request: request(source), accountPerformance: "not-connected" } });
  expect(state.operations[0]!.findings).toBeUndefined();
  expect(state.operations[0]!.recordedScope).not.toHaveProperty("path");
  expect(listBuiltinToolCapabilities().find(tool => tool.name === "annual_report")?.requirements).toMatchObject({ capability: "annual-research", effects: ["local-read", "research-storage"] });
  for (const market of ["A", "US", "HK", "Fund"] as const) {
    expect(inspectToolReadiness(loadSettings(), { market }, {}).find(tool => tool.name === "annual_report")?.status).toBe("local");
  }
  expect(loadAnnualReport(details.id).html).toBe(readFileSync(details.path, "utf8"));
  // Verifying a report does not change the archived public dataset.
  const dataset = source.result.input.prices[0]!.dataset!;
  if (dataset.kind !== "daily-bars") throw new Error("Expected bars fixture");
  expect(loadDataset(dataset)[0]!.close).toBe(100);
});
