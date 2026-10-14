import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import * as source from "../../source/index.ts";
import { archiveFundNav, loadPanelPortfolio, savePanelPortfolio, saveBars, savePortfolioComparison, loadArtifact, saveArtifact, artifactReference } from "../../storage/index.ts";
import { comparePortfoliosTool, portfolioComparisonsTool } from "../../tools/portfolio-tools.ts";
import { runPortfolioComparison } from "../../runtime/research/portfolio-comparison.ts";
import { comparePortfolios } from "../../quant/portfolio-comparison.ts";
import { comparisonFixture } from "../../quant/test/fixtures/portfolio-comparison.ts";
import type { PortfolioComparisonArtifact, PortfolioComparisonRequest } from "../../types/portfolio-comparison.ts";
import { buildResearchReport } from "../../research/input.ts";
import { loadReportSession } from "../src/report-input.ts";
import { renderShareReport } from "../src/research-renderer.ts";
import { generateArtifact } from "../src/generator.ts";

let root: string, previous: string | undefined;
const PRIVATE = "PRIVATE_COMPARISON_7281", fixture = comparisonFixture();
const args: Parameters<typeof comparePortfoliosTool.execute>[1] = { group_a: `${PRIVATE} A`, group_b: "growth",
  start: fixture.start, end: fixture.end, benchmark: "spy", base_currency: "CNY",
  currencies: { aapl: "USD", MSFT: "USD", SPY: "USD" }, weighting: "rebalance" };
const restores: Array<() => void> = [];
beforeEach(async () => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "ohq-report-comparison-")); process.env.OHQUANT_DIR = root;
  const groups = loadPanelPortfolio();
  groups.groups = fixture.groups.map((group, index) => ({ id: group.id, name: `${PRIVATE} ${index === 0 ? "A" : "B"}`, symbolCodes: [...group.members] }));
  groups.symbols = fixture.prices.map(price => ({ code: price.symbol, name: PRIVATE, added: "2025-01-01" }));
  savePanelPortfolio(groups);
  for (const price of fixture.prices) await saveBars(price.symbol, "financial-datasets", price.points.map(point => ({ date: point.date,
    open: point.price, high: point.price, low: point.price, close: point.price, volume: 1, amount: point.price })), fixture.start, fixture.end);
  const fx = spyOn(source, "fetchComparisonFx").mockImplementation(async baseCurrency => baseCurrency === "USD" ? structuredClone(fixture.fx) : ({ baseCurrency, source: "frankfurter-v2/ecb",
    observedAt: "2025-01-03T00:00:00.000Z", points: fixture.prices[0]!.points.map((point, index) => ({ date: point.date, currency: "USD", rate: [7, 7.7, 8.4][index]! })) }));
  restores.push(() => fx.mockRestore());
});
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected comparison fixture directory");
  rmSync(root, { recursive: true, force: true });
});

function transcript(details: unknown, parameters: Record<string, unknown> = args, name = "compare_portfolios"): string {
  const path = join(root, "comparison.jsonl");
  writeFileSync(path, [
    { type: "session", version: 3, id: PRIVATE, cwd: root },
    { type: "message", id: "u", parentId: null, message: { role: "user", content: `${PRIVATE} account 9876543.21` } },
    { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [{ type: "toolCall", id: "c", name, arguments: parameters }] } },
    { type: "message", id: "t", parentId: "a", message: { role: "toolResult", toolCallId: "c", toolName: name, content: [{ type: "text", text: PRIVATE }], details } },
  ].map(value => JSON.stringify(value)).join("\n") + "\n");
  return path;
}
function report(details: unknown, parameters: Record<string, unknown> = args, name = "compare_portfolios") {
  return buildResearchReport(loadReportSession(transcript(details, parameters, name))!);
}
function rewriteArchive(artifact: PortfolioComparisonArtifact): void {
  writeFileSync(join(root, "benchmark", "comparisons", "portfolios", `${artifact.id}.json`), JSON.stringify({ artifact, hash: createHash("sha256").update(JSON.stringify(artifact)).digest("hex") }));
}
function publicCopy(html: string): string { return JSON.parse(html.match(/<script type="application\/json" id="share-document">([\s\S]*?)<\/script>/)![1]!); }

it("binds the actual comparison tool, FX and archived prices; shares independently checked normalized returns only", async () => {
  const result = await comparePortfoliosTool.execute("c", args), data = report(result.details);
  expect(data.exclusions).toEqual({ unavailableInputs: 0, unverifiedResults: 0, unsupportedResults: 0 });
  expect(data.analyses.map(analysis => analysis.kind)).toEqual(["portfolio-comparison"]);
  const comparison = data.analyses[0]!.comparison!;
  expect(comparison.series[0]!.values[1]).toBeCloseTo(1.375, 12);
  expect(comparison.series[0]!.values[2]).toBeCloseTo(1.875, 12);
  expect(comparison.series[1]!.values[2]).toBeCloseTo(1.2, 12);
  expect(comparison.series[2]!.values[2]).toBeCloseTo(1.452, 12);
  expect(comparison.series[0]!.members[0]!.localReturn).toBe(0);
  expect(comparison.series[0]!.members[0]!.baseReturn).toBeCloseTo(0.2, 12);
  const generated = generateArtifact({ sessionPath: transcript(result.details), leafId: "t", title: PRIVATE })!;
  expect(generated.provenance.datasets).toHaveLength(3);
  expect(generated.provenance.datasets.every(dataset => dataset.verified)).toBe(true);
  const html = publicCopy(generated.html);
  expect(html).toContain("data-research-comparison"); expect(html).toContain("87.50%"); expect(html).toContain("45.20%");
  expect(html.match(/data-comparison-series=/g)).toHaveLength(3);
  expect(html).toContain("data-comparison-fx"); expect(html).toContain("frankfurter-v2/ecb");
  expect(html).not.toMatch(/PRIVATE_COMPARISON|9876543\.21|portfolioRevision|<script|<iframe|src=/);
  expect(html).not.toContain(root); expect(html).not.toContain((result.details as PortfolioComparisonArtifact).id);
  expect(generated.html).toContain(PRIVATE);
});

it("does not invent fund or stock lookup pages from a title when the archived provider identity is unknown", async () => {
  const result = await comparePortfoliosTool.execute("c", args);
  const generated = generateArtifact({ sessionPath: transcript(result.details), leafId: "t",
    title: "指数 000001.SZ / 基金 000001.OF" })!;
  expect(generated.provenance.datasets.every(dataset => dataset.verified)).toBe(true);
  expect(generated.html).not.toContain("danjuanfunds.com/funding/000001");
  expect(generated.html).not.toContain("fund.10jqka.com.cn/000001/");
  expect(generated.html).not.toContain("xueqiu.com/S/SZ000001");
  expect(generated.html).not.toContain("stockpage.10jqka.com.cn/000001/");
});

it("rejects altered group selection, dates, currency, method, missing policy or weights", async () => {
  const { details } = await comparePortfoliosTool.execute("c", args);
  for (const change of [{ group_a: "growth" }, { end: "2025-01-03" }, { start: "2024-01-03" }, { benchmark: "AAPL" },
    { base_currency: "USD" }, { currencies: { AAPL: "HKD", MSFT: "USD", SPY: "USD" } }, { weighting: "buy-and-hold" },
    { missing_members: "exclude" }, { weights_a: { AAPL: 0.7, MSFT: 0.3 } }]) {
    const rejected = report(details, { ...args, ...change });
    expect(rejected.analyses).toHaveLength(0); expect(rejected.exclusions.unverifiedResults).toBe(1);
  }
});

it("renders same-currency identity conversion and binds explicit weights after the JSON round trip", async () => {
  const weightedArgs = { ...args, base_currency: "USD", weights_a: { aapl: 0.7, MSFT: 0.3 } };
  const artifact = (await comparePortfoliosTool.execute("c", weightedArgs)).details as PortfolioComparisonArtifact;
  const projected = report(artifact, weightedArgs), comparison = projected.analyses[0]!.comparison!;
  // First interval 0.7*2 + 0.3*0.5 = 1.55; second factor 0.7*0.5 + 0.3*2 = 0.95.
  expect(comparison.series[0]!.values.at(-1)).toBeCloseTo(1.4725, 12);
  expect(comparison.fx.points).toEqual([]); expect(comparison.fx.source).toBe("identity");
  expect(renderShareReport(projected)).toContain("恒等换算");
  const history = await portfolioComparisonsTool.execute("h", { id: artifact.id });
  expect(report(history.details, { id: artifact.id }, "portfolio_comparisons").analyses).toEqual(projected.analyses);
});

it.each(["buy-and-hold", "rebalance"] as const)("projects and shares the actual %s method for old and new verified archives", async weighting => {
  const parameters = { ...args, weighting, base_currency: "USD" };
  const original = (await comparePortfoliosTool.execute("c", parameters)).details as PortfolioComparisonArtifact;
  for (const version of [1, 2] as const) {
    const artifact = structuredClone(original);
    if (version === 1) {
      artifact.result.methodVersion = 1;
      artifact.result.assumptions.warning = "Hypothetical allocations, not account holdings. No fees, taxes, dividends or corporate-action repair. Rebalance at common valuation dates only. Annualized risk approximates irregular observation intervals; VaR is per interval, not necessarily one trading day. Daily closes across markets are not simultaneous; FX is a reference rate, not an execution quote.";
    }
    rewriteArchive(artifact);
    const path = join(root, "benchmark", "comparisons", "portfolios", `${artifact.id}.json`), before = readFileSync(path, "utf8");
    const history = await portfolioComparisonsTool.execute("h", { id: artifact.id });
    const projected = report(history.details, { id: artifact.id }, "portfolio_comparisons");
    expect(projected.analyses).toHaveLength(1);
    const analysis = projected.analyses[0]!;
    expect(analysis.comparison!.series[0]!.values).toEqual(weighting === "buy-and-hold" ? [1, 1.25, 1] : [1, 1.25, 1.5625]);
    const expected = weighting === "buy-and-hold" ? "no rebalancing" : "restore the specified target weights";
    expect(analysis.assumptions.join("\n")).toContain(expected);
    const html = renderShareReport(projected)!;
    expect(html).toContain(expected);
    expect(html).toContain("3 common valuation dates form 2 adjacent return intervals");
    expect(html).toContain("final NAV / initial NAV - 1");
    expect(html).not.toContain("Rebalance at common valuation dates only");
    expect(readFileSync(path, "utf8")).toBe(before);
  }
});

it("rejects altered result, prices, FX and metadata even when the edited result remains internally consistent", async () => {
  const original = (await comparePortfoliosTool.execute("c", args)).details as PortfolioComparisonArtifact;
  for (const change of ["metric", "price", "fx", "date", "source", "observation"] as const) {
    const edited = structuredClone(original);
    if (change === "metric") edited.result.groups[0].totalReturn = 99;
    if (change === "price") edited.result.input.prices[0]!.points[1]!.price = 333;
    if (change === "fx") edited.result.input.fx.points[0]!.rate = 9;
    if (change === "date") edited.result.input.fx.points[0]!.date = "2023-01-01";
    if (change === "source") edited.result.input.prices[0]!.source = "akshare";
    if (change === "observation") edited.result.input.prices[0]!.observedAt = "2026-01-01T00:00:00.000Z";
    if (change !== "metric") edited.result = comparePortfolios(edited.result.input);
    expect(report(edited).analyses).toHaveLength(0);
  }
  // Rewriting the comparison hash cannot turn different prices into the referenced Bars revision.
  const edited = structuredClone(original); edited.result.input.prices[0]!.points[1]!.price = 333;
  edited.result = comparePortfolios(edited.result.input); rewriteArchive(edited);
  expect(report(edited).analyses).toHaveLength(0);
});

it("checks internal request bindings and FX provenance independently of archive checksums", async () => {
  const original = (await comparePortfoliosTool.execute("c", args)).details as PortfolioComparisonArtifact;
  for (const change of ["currency", "weights", "selector", "fx-source", "fx-time", "fx-window", "arithmetic"] as const) {
    const edited = structuredClone(original);
    if (change === "currency") edited.result.input.request!.currencies.aapl = "EUR";
    if (change === "weights") edited.result.input.request!.weights = [{ AAPL: 0.7, MSFT: 0.3 }, null];
    if (change === "selector") edited.result.input.request!.groups[0] = "unrelated";
    if (change === "fx-source") edited.result.input.fx.source = PRIVATE;
    if (change === "fx-time") edited.result.input.fx.observedAt = PRIVATE;
    if (change === "fx-window") edited.result.input.fx.points.push({ currency: "USD", date: "2023-01-01", rate: 7 });
    if (change === "arithmetic") edited.result.groups[0].totalReturn = 9;
    rewriteArchive(edited);
    const rejected = report(edited, { id: edited.id }, "portfolio_comparisons");
    expect(rejected.analyses).toHaveLength(0); expect(rejected.exclusions.unverifiedResults).toBe(1);
  }
});

it("retains captured values after group/cache edits, but never substitutes missing evidence when regenerating", async () => {
  const artifact = (await comparePortfoliosTool.execute("c", args)).details as PortfolioComparisonArtifact;
  const path = transcript(artifact), generated = generateArtifact({ sessionPath: path })!, before = publicCopy(generated.html);
  const saved = saveArtifact(generated.sessionId, generated.html, { title: generated.title, messageCount: generated.messageCount, provenance: generated.provenance });
  const groups = loadPanelPortfolio(); groups.groups = []; savePanelPortfolio(groups);
  await saveBars("AAPL", "financial-datasets", fixture.prices[0]!.points.map(point => ({ date: point.date, open: 900, high: 900, low: 900, close: 900, volume: 1, amount: 900 })), fixture.start, fixture.end);
  expect(publicCopy(generateArtifact({ sessionPath: path })!.html)).toBe(before);
  const archive = join(root, "benchmark", "comparisons", "portfolios", `${artifact.id}.json`);
  rmSync(archive);
  expect(report(artifact).analyses).toHaveLength(0);
  rewriteArchive(artifact);
  const ref = artifact.result.input.prices[0]!.dataset!;
  rmSync(join(root, "data", ref.source, ref.symbol, "revisions", `${ref.revision}.json`));
  const unavailable = report(artifact);
  expect(unavailable.analyses).toHaveLength(0); expect(unavailable.exclusions.unavailableInputs).toBe(1);
  expect(publicCopy(loadArtifact(artifactReference(saved))!)).toBe(before);
});

it("reopens historical comparisons, ignores listings and marks missing request binding unsupported", async () => {
  const artifact = (await comparePortfoliosTool.execute("c", args)).details as PortfolioComparisonArtifact;
  const history = await portfolioComparisonsTool.execute("h", { id: artifact.id });
  expect(report(history.details, { id: artifact.id }, "portfolio_comparisons").analyses).toHaveLength(1);
  expect(report(history.details, { id: "different" }, "portfolio_comparisons").analyses).toHaveLength(0);
  const listing = await portfolioComparisonsTool.execute("l", {});
  expect(report(listing.details, {}, "portfolio_comparisons").exclusions).toEqual({ unavailableInputs: 0, unverifiedResults: 0, unsupportedResults: 0 });
  delete artifact.result.input.request; rewriteArchive(artifact);
  expect(report(artifact, { id: artifact.id }, "portfolio_comparisons").exclusions.unsupportedResults).toBe(1);
});

it("requires an earlier unique matching call and one result", async () => {
  const artifact = (await comparePortfoliosTool.execute("c", args)).details;
  for (const mode of ["duplicate-call", "duplicate-result", "result-first", "wrong-tool", "no-call"] as const) {
    const input = loadReportSession(transcript(artifact))!;
    if (mode === "duplicate-call") input.lines.push(input.lines[1]!);
    if (mode === "duplicate-result") input.lines.push(input.lines[2]!);
    if (mode === "result-first") [input.lines[1], input.lines[2]] = [input.lines[2]!, input.lines[1]!];
    if (mode === "wrong-tool") (input.lines[2]!.message as Record<string, unknown>).toolName = "portfolio_comparisons";
    if (mode === "no-call") input.lines.splice(1, 1);
    expect(buildResearchReport(input).analyses).toHaveLength(0);
  }
});

it("binds NAV archives, custom weights, empty-member exclusions and missing same-day FX without leaking reasons", async () => {
  const original = (await comparePortfoliosTool.execute("c", args)).details as PortfolioComparisonArtifact;
  const data = loadPanelPortfolio(); data.groups[0]!.symbolCodes = ["270042.OF", "MSFT", "AMZN"];
  data.symbols.push({ code: "270042.OF", name: PRIVATE, added: "2025-01-01", instrument: "fund" }); savePanelPortfolio(data);
  const observedAt = "2025-01-03T00:00:00.000Z";
  const nav = fixture.prices[0]!.points.map(point => ({ fundCode: "270042", navDate: point.date, unitNav: point.price / 100,
    accumulatedNav: null, dailyReturnPct: null, isOpenDay: true, source: "akshare" }));
  const ref = (await archiveFundNav("270042.OF", nav, "fund_open_fund_info_em", observedAt))!;
  const request: PortfolioComparisonRequest = { groups: [args.group_a, args.group_b], start: args.start, end: args.end, benchmark: "SPY", baseCurrency: "CNY",
    currencies: { "270042.OF": "CNY", MSFT: "USD", AMZN: "USD", SPY: "USD" }, weighting: "buy-and-hold", missingMembers: "exclude",
    weights: [{ "270042.OF": 0.2, MSFT: 0.6, AMZN: 0.2 }, null] };
  const artifact = await runPortfolioComparison(request, undefined, { portfolio: loadPanelPortfolio, save: savePortfolioComparison,
    price: async (symbol, currency) => symbol === "270042.OF" ? { symbol, currency, source: "akshare", origin: "provider", observedAt, dataset: ref,
      points: nav.map(row => ({ date: row.navDate, price: row.unitNav })) } : symbol === "AMZN" ? { symbol, currency, source: "unavailable", origin: "unavailable", observedAt: "unknown", points: [], unavailableReason: PRIVATE }
      : original.result.input.prices.find(price => price.symbol === symbol)!,
    fx: async () => ({ ...original.result.input.fx, points: original.result.input.fx.points.filter(point => point.date !== "2024-07-02") }) });
  const projected = report(artifact, { id: artifact.id }, "portfolio_comparisons");
  expect(projected.analyses).toHaveLength(1);
  expect(projected.analyses[0]!.comparison!.dates).toEqual(["2024-01-02", "2025-01-02"]);
  const members = projected.analyses[0]!.comparison!.series[0]!.members;
  expect(members[0]!.initialWeight).toBeCloseTo(0.25, 12); expect(members[1]!.initialWeight).toBeCloseTo(0.75, 12);
  const html = renderShareReport(projected)!;
  expect(html).toContain("270042.OF"); expect(html).toContain("AMZN"); expect(html).toContain("fx:USD/CNY"); expect(html).toContain("N/A");
  expect(html).not.toContain(PRIVATE);
});
