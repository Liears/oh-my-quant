import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { analyzeArchivedBarsTool } from "../../tools/archived-analysis-tool.ts";
import { computeFactorTool, runBacktestTool, checkRiskTool, createPriceAnalysisTools } from "../../tools/quant-tools.ts";
import { loadAnalysisBars } from "../../runtime/analysis-data.ts";
import { buildResearchReport } from "../../research/input.ts";
import { projectResearchState } from "../../research/state.ts";
import { readBarsSnapshot, saveBars } from "../src/bars.ts";
import type { Bar, BarsSnapshot } from "../../types/data.ts";

let root: string, previous: string | undefined;
let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
const source = "financial-datasets" as const, symbol = "AAPL", market = "US" as const;
const start = "2025-01-01", end = "2025-03-21", cutoff = "2025-03-22T00:00:00.000Z";
const observedAt = "2025-03-21T23:00:00.000Z";

beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-archive-analysis-")); process.env.OHQUANT_DIR = root;
  network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Archived calculation contacted a provider"));
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); network.mockRestore();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected archive analysis fixture directory");
  rmSync(root, { recursive: true, force: true });
});

function bars(base: number): Bar[] {
  const first = new Date(`${start}T00:00:00.000Z`);
  return Array.from({ length: 80 }, (_, index) => {
    const date = new Date(first); date.setUTCDate(first.getUTCDate() + index);
    const close = base + index * 0.7;
    return { date: date.toISOString().slice(0, 10), open: close, high: close, low: close,
      close, volume: 100 + index, amount: null };
  });
}

function archivedAt(snapshot: BarsSnapshot): string {
  const payload = { version: 1 as const, bars: snapshot.bars, meta: { ...snapshot.meta, fetchedAt: observedAt } };
  const revision = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const committed = { ...payload, revision };
  const dir = join(root, "data", snapshot.meta.source, snapshot.meta.symbol, "revisions");
  writeFileSync(join(dir, `${revision}.json`), JSON.stringify(committed));
  writeFileSync(join(dir, `${revision}.commit`), JSON.stringify({ version: 1, revision,
    snapshotHash: createHash("sha256").update(JSON.stringify(committed)).digest("hex") }));
  return revision;
}

test("factor, backtest and risk reuse one prior response and do not touch later prices or provider settings", async () => {
  await saveBars(symbol, source, bars(100), start, end);
  const revision = archivedAt(readBarsSnapshot(symbol, source)!);
  await saveBars(symbol, source, bars(900), start, end);
  const brokenSettings = join(root, "settings.json"); writeFileSync(brokenSettings, "{broken provider config");
  const common = { symbol, market, source, start, end, observed_before: cutoff };
  const calculations = [
    await analyzeArchivedBarsTool.execute("factor", { ...common, analysis: "factor", factor: "momentum", period: 20 }),
    await analyzeArchivedBarsTool.execute("backtest", { ...common, analysis: "backtest", fast: 5, slow: 20 }),
    await analyzeArchivedBarsTool.execute("risk", { ...common, analysis: "risk" }),
  ];
  for (const [index, result] of calculations.entries()) {
    expect(result.details).toMatchObject({ dataset: { revision, snapshotAt: observedAt }, observationAt: observedAt,
      historicalAvailability: "app-archive-observed-before", historicalBoundary: { observedBefore: cutoff, evidence: "app-archive" } });
    const text = result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
    expect(text).toContain(`Archive cutoff ${cutoff}`);
    expect(text).toContain("provider publication and trading-day completeness unverified");
    expect((result.details as { analysis: string }).analysis).toBe(["factor", "backtest", "risk"][index]);
  }
  expect(readBarsSnapshot(symbol, source)?.bars.at(-1)?.close).toBe(bars(900).at(-1)!.close);
  expect(readFileSync(brokenSettings, "utf8")).toBe("{broken provider config");
});

test("ordinary factor, backtest and risk tools honor one UTC archive cutoff through report and task recovery", async () => {
  await saveBars(symbol, source, bars(100), start, end);
  const revision = archivedAt(readBarsSnapshot(symbol, source)!);
  await saveBars(symbol, source, bars(900), start, end);
  writeFileSync(join(root, "settings.json"), "{broken provider config");
  const common = { symbol, market, source, start, end, observed_before: cutoff };
  const calls = [
    { name: "compute_factor", args: { ...common, factor: "momentum" as const, period: 20 }, result: await computeFactorTool.execute("ordinary-factor", { ...common, factor: "momentum", period: 20 }) },
    { name: "run_backtest", args: { ...common, fast: 5, slow: 20 }, result: await runBacktestTool.execute("ordinary-backtest", { ...common, fast: 5, slow: 20 }) },
    { name: "check_risk", args: common, result: await checkRiskTool.execute("ordinary-risk", common) },
  ];
  for (const call of calls) {
    expect(call.result.details).toMatchObject({ dataset: { revision, snapshotAt: observedAt }, observationAt: observedAt,
      archiveRequest: { symbol, market, source, start, end, observedBefore: cutoff },
      historicalBoundary: { evidence: "app-archive", observedBefore: cutoff }, historicalAvailability: "app-archive-observed-before" });
    expect(call.result.content.filter(item => item.type === "text").map(item => item.text).join("\n"))
      .toContain(`Archive cutoff ${cutoff}`);
  }
  const lines = calls.flatMap((call, index) => [{ type: "message", id: `call-${index}`,
    message: { role: "assistant", content: [{ type: "toolCall", id: `ordinary-${index}`, name: call.name, arguments: call.args }] } },
  { type: "message", id: `result-${index}`, message: { role: "toolResult", toolCallId: `ordinary-${index}`,
    toolName: call.name, details: call.result.details } }]);
  const report = buildResearchReport({ lines });
  expect(report.bindings.map(binding => binding.toolName)).toEqual(["compute_factor", "run_backtest", "check_risk"]);
  expect(report.analyses.map(analysis => analysis.kind)).toEqual(["factor", "backtest", "risk"]);
  expect(report.datasets).toHaveLength(1);
  expect(report.datasets[0]?.ref.revision).toBe(revision);
  for (const analysis of report.analyses) expect(analysis.assumptions.join(" ")).toContain(`UTC cutoff ${cutoff}`);
  const spec = { id: "ordinary-archive-study", request: "截至旧观察时刻研究 AAPL", goal: "按旧修订验证三项研究",
    scope: { symbols: [symbol], market, start, end }, constraints: { allowedTools: calls.map(call => call.name), notes: [] },
    criteria: calls.map((call, index) => ({ id: `criterion-${index}`, description: "旧修订可重算", tool: call.name,
      parameters: call.args, metrics: [["Latest"], ["Total return"], ["Annual volatility"]][index]! })),
    dataRefs: [], reportRequired: false };
  const task = { type: "custom_message", id: "task", customType: "research_task",
    details: { version: 1, type: "declare", expectedRevision: null, task: spec } };
  const state = projectResearchState([task, ...lines], calls.map(call => call.name));
  expect(state.operations.map(operation => operation.status)).toEqual(["verified", "verified", "verified"]);
  expect(state.task?.criteria.map(criterion => criterion.status)).toEqual(["satisfied", "satisfied", "satisfied"]);
  const forged = structuredClone(lines);
  (forged[1]!.message as { details: Record<string, unknown> }).details = {
    ...calls[0]!.result.details as Record<string, unknown>, observationAt: "2025-03-22T01:00:00.000Z" };
  expect(buildResearchReport({ lines: forged }).exclusions.unverifiedResults).toBe(1);
  const wrongCutoff = structuredClone(spec);
  wrongCutoff.criteria[0]!.parameters.observed_before = "2025-03-21T00:00:00.000Z";
  const wrongTask = projectResearchState([{ ...task, details: { ...task.details, task: wrongCutoff } }, ...lines], calls.map(call => call.name));
  expect(wrongTask.task?.criteria[0]?.status).not.toBe("satisfied");
  const noCutoff = structuredClone(spec);
  const currentParameters = noCutoff.criteria[0]!.parameters as Record<string, unknown>;
  delete currentParameters.observed_before;
  delete currentParameters.market;
  delete currentParameters.source;
  const currentTask = projectResearchState([{ ...task, details: { ...task.details, task: noCutoff } }, ...lines], calls.map(call => call.name));
  expect(currentTask.task?.criteria[0]?.status).not.toBe("satisfied");
  expect(readBarsSnapshot(symbol, source)?.bars.at(-1)?.close).toBe(bars(900).at(-1)!.close);
});

test("ordinary historical tools fail closed on missing, damaged and invalid boundaries without a live fallback", async () => {
  const common = { symbol, market, source, start, end, observed_before: cutoff };
  const custom = createPriceAnalysisTools(async () => { throw new Error("Injected live data port must not be used for archives."); });
  const noPort = await custom.checkRiskTool.execute("port", common);
  expect(noPort.details).toMatchObject({ error: { code: "DATA_ARCHIVE_PORT_UNAVAILABLE" } });
  expect(noPort.content.filter(part => part.type === "text").map(part => part.text).join("\n"))
    .toContain("archiveAnalysisData");
  expect((await computeFactorTool.execute("missing", { ...common, factor: "momentum", period: 20 })).details)
    .toMatchObject({ error: { code: "DATA_NO_ASOF_ARCHIVE" } });
  expect((await runBacktestTool.execute("bad-cutoff", { ...common, observed_before: "2025-02-30T00:00:00.000Z" })).details)
    .toMatchObject({ error: { code: "DATA_INVALID_OBSERVATION_CUTOFF" } });
  expect((await checkRiskTool.execute("missing-window", { ...common, start: undefined })).details)
    .toMatchObject({ error: { code: "INPUT_INVALID_ANALYSIS_PARAMETERS" } });
  await saveBars(symbol, source, bars(100), start, end);
  const revision = archivedAt(readBarsSnapshot(symbol, source)!);
  const injected = createPriceAnalysisTools(async () => { throw new Error("Injected live port must stay idle."); }, loadAnalysisBars);
  expect((await injected.checkRiskTool.execute("archive-port", common)).details)
    .toMatchObject({ dataset: { revision }, historicalBoundary: { observedBefore: cutoff, evidence: "app-archive" } });
  writeFileSync(join(root, "data", source, symbol, "revisions", `${"a".repeat(64)}.json`), "damaged archive");
  expect((await checkRiskTool.execute("damaged", common)).details).toMatchObject({ error: { code: "DATA_ASOF_ARCHIVE_UNAVAILABLE" } });
});

test("ordinary archive mode retains canonical A-share identity for a bare six-digit symbol", async () => {
  const aSymbol = "000001.SZ", aSource = "akshare";
  await saveBars(aSymbol, aSource, bars(100), start, end);
  const revision = archivedAt(readBarsSnapshot(aSymbol, aSource)!);
  await saveBars(aSymbol, aSource, bars(900), start, end);
  const args = { symbol: "000001", market: "A" as const, source: "akshare" as const,
    start, end, observed_before: cutoff, factor: "momentum" as const, period: 20 };
  const result = await computeFactorTool.execute("bare-a", args);
  expect(result.details).toMatchObject({ dataset: { symbol: aSymbol, market: "A", revision },
    archiveRequest: { symbol: "000001", market: "A", observedBefore: cutoff } });
  const lines = [{ type: "message", id: "call", message: { role: "assistant", content: [{ type: "toolCall",
    id: "bare-a", name: "compute_factor", arguments: args }] } },
  { type: "message", id: "result", message: { role: "toolResult", toolCallId: "bare-a",
    toolName: "compute_factor", details: result.details } }];
  expect(buildResearchReport({ lines }).bindings).toMatchObject([{ toolName: "compute_factor" }]);
});

test("archived calculation returns typed missing, damaged and invalid-cutoff outcomes without trying current data", async () => {
  const common = { symbol, market, source, start, end };
  const invalidMode = await analyzeArchivedBarsTool.execute("factor-param", { ...common, analysis: "factor", observed_before: cutoff });
  expect(invalidMode.details).toMatchObject({ error: { code: "INPUT_INVALID_ANALYSIS_PARAMETERS" } });
  const irrelevant = await analyzeArchivedBarsTool.execute("risk-param", { ...common, analysis: "risk", factor: "momentum", observed_before: cutoff });
  expect(irrelevant.details).toMatchObject({ error: { code: "INPUT_INVALID_ANALYSIS_PARAMETERS" } });
  const invalidDates = await analyzeArchivedBarsTool.execute("dates", { ...common, analysis: "risk", end: "2025-02-30", observed_before: cutoff });
  expect(invalidDates.details).toMatchObject({ error: { code: "INPUT_INVALID_ANALYSIS_PARAMETERS" } });
  const missing = await analyzeArchivedBarsTool.execute("missing", { ...common, analysis: "risk", observed_before: cutoff });
  expect(missing.details).toMatchObject({ error: { code: "DATA_NO_ASOF_ARCHIVE" } });
  await saveBars(symbol, source, bars(100), start, end);
  archivedAt(readBarsSnapshot(symbol, source)!);
  const invalid = await analyzeArchivedBarsTool.execute("invalid", { ...common, analysis: "risk", observed_before: "2025-02-30T00:00:00.000Z" });
  expect(invalid.details).toMatchObject({ error: { code: "DATA_INVALID_OBSERVATION_CUTOFF" } });
  const damagedFile = join(root, "data", source, symbol, "revisions", `${"a".repeat(64)}.json`);
  writeFileSync(damagedFile, "damaged archive");
  const damaged = await analyzeArchivedBarsTool.execute("damaged", { ...common, analysis: "risk", observed_before: cutoff });
  expect(damaged.details).toMatchObject({ error: { code: "DATA_ASOF_ARCHIVE_UNAVAILABLE" } });
  expect(readFileSync(damagedFile, "utf8")).toBe("damaged archive");
});

test("report and resumed research recheck archive cutoff, version and backtest arithmetic", async () => {
  await saveBars(symbol, source, bars(100), start, end);
  const revision = archivedAt(readBarsSnapshot(symbol, source)!);
  await saveBars(symbol, source, bars(900), start, end);
  const args = { symbol, market, source, start, end, observed_before: cutoff, analysis: "backtest" as const, fast: 5, slow: 20 };
  const result = await analyzeArchivedBarsTool.execute("study", args);
  const lines = [
    { type: "message", id: "call", message: { role: "assistant", content: [{ type: "toolCall", id: "study", name: "analyze_archived_bars", arguments: args }] } },
    { type: "message", id: "result", message: { role: "toolResult", toolCallId: "study", toolName: "analyze_archived_bars", details: result.details } },
  ];
  const report = buildResearchReport({ lines });
  expect(report.bindings).toMatchObject([{ toolName: "analyze_archived_bars" }]);
  expect(report.datasets[0]?.ref.revision).toBe(revision);
  expect(report.analyses[0]).toMatchObject({ kind: "backtest" });
  expect(report.analyses[0]?.assumptions.join(" ")).toContain(`UTC cutoff ${cutoff}`);
  const state = projectResearchState(lines, ["analyze_archived_bars"]);
  expect(state.operations[0]).toMatchObject({ tool: "analyze_archived_bars", status: "verified", parameters: { observed_before: cutoff } });
  expect(state.operations[0]?.references[0]).toMatchObject({ role: "input", available: true });
  const spec = { id: "archive-study", request: "截至指定时刻回测 AAPL", goal: "固定归档版本回测",
    scope: { symbols: [symbol], market, start, end },
    constraints: { allowedTools: ["analyze_archived_bars"], notes: [] },
    criteria: [{ id: "return", description: "归档回测收益可复核", tool: "analyze_archived_bars", parameters: args, metrics: ["Total return"] }],
    dataRefs: [], reportRequired: false };
  const taskEntry = { type: "custom_message", id: "task", customType: "research_task",
    details: { version: 1, type: "declare", expectedRevision: null, task: spec } };
  const taskState = projectResearchState([taskEntry, ...lines], ["analyze_archived_bars"]);
  expect(taskState.task?.criteria[0]).toMatchObject({ id: "return", status: "satisfied" });
  const wrongSpec = structuredClone(spec);
  wrongSpec.criteria[0]!.parameters.observed_before = "2025-03-21T00:00:00.000Z";
  const wrongTask = projectResearchState([{ ...taskEntry, details: { ...taskEntry.details, task: wrongSpec } }, ...lines], ["analyze_archived_bars"]);
  expect(wrongTask.task?.criteria[0]?.status).not.toBe("satisfied");

  const forgedObservation = structuredClone(lines);
  (forgedObservation[1]!.message as { details?: Record<string, unknown> }).details = { ...result.details as Record<string, unknown>, observationAt: "2025-03-22T01:00:00.000Z" };
  expect(buildResearchReport({ lines: forgedObservation }).exclusions.unverifiedResults).toBe(1);
  const forgedResult = structuredClone(lines);
  (forgedResult[1]!.message as { details?: Record<string, unknown> }).details = { ...result.details as Record<string, unknown>, totalReturn: 0.99 };
  expect(buildResearchReport({ lines: forgedResult }).exclusions.unverifiedResults).toBe(1);
  const wrongCutoff = structuredClone(lines);
  (wrongCutoff[0]!.message as { content: Array<{ arguments: Record<string, unknown> }> }).content[0]!.arguments.observed_before = "2025-03-21T00:00:00.000Z";
  expect(buildResearchReport({ lines: wrongCutoff }).exclusions.unverifiedResults).toBe(1);
});

test("a report retains the tagged response endpoint needed to resolve its immutable revision", async () => {
  await saveBars(symbol, source, bars(100), start, end, undefined, "prices");
  const revision = archivedAt(readBarsSnapshot(symbol, source)!);
  await saveBars(symbol, source, bars(900), start, end, undefined, "prices");
  const args = { symbol, market, source, start, end, observed_before: cutoff, analysis: "factor" as const, factor: "momentum" as const, period: 20 };
  const result = await analyzeArchivedBarsTool.execute("endpoint-study", args);
  expect(result.details).toMatchObject({ dataset: { revision, providerEndpoint: "prices" } });
  const lines = [
    { type: "message", id: "endpoint-call", message: { role: "assistant", content: [{ type: "toolCall", id: "endpoint-study", name: "analyze_archived_bars", arguments: args }] } },
    { type: "message", id: "endpoint-result", message: { role: "toolResult", toolCallId: "endpoint-study", toolName: "analyze_archived_bars", details: result.details } },
  ];
  const report = buildResearchReport({ lines });
  expect(report.bindings).toMatchObject([{ toolName: "analyze_archived_bars" }]);
  expect(report.datasets[0]?.ref).toMatchObject({ revision, providerEndpoint: "prices" });
  const state = projectResearchState(lines, ["analyze_archived_bars"]);
  expect(state.operations[0]).toMatchObject({ status: "verified", references: [{ available: true, ref: { providerEndpoint: "prices" } }] });
  const forgedEndpoint = structuredClone(lines);
  (forgedEndpoint[1]!.message as { details?: Record<string, unknown> }).details = { ...result.details as Record<string, unknown>,
    dataset: { ...(result.details as { dataset: Record<string, unknown> }).dataset, providerEndpoint: "https://secret.example/key" } };
  expect(buildResearchReport({ lines: forgedEndpoint }).analyses).toEqual([]);
});
