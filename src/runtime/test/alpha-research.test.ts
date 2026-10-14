import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { runAlphaResearch, restoreAlphaResearch, type AlphaResearchDeps } from "../research/alpha-research.ts";
import { saveBars, loadDataset, saveAlphaRun, loadAlphaRun, listAlphaRuns, resolveAlphaRunsDir } from "../../storage/index.ts";
import { researchRequest, researchBars, researchEngine } from "../../alpha/test/fixtures/research.ts";
import { buildResearchReport } from "../../research/input.ts";
import { projectResearchState } from "../../research/state.ts";
import { renderShareReport } from "../../artifact/src/research-renderer.ts";
import { createBuiltinTools } from "../../tools/registry.ts";
import type { AlphaRunArtifact } from "../../types/alpha.ts";
import { Compile } from "typebox/compile";
import { inspectToolReadiness } from "../data/tool-readiness.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";

let root: string, previous: string | undefined, deps: AlphaResearchDeps;
beforeEach(async () => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-alpha-research-")); process.env.OHQUANT_DIR = root;
  const dataset = (await saveBars("AAPL", "financial-datasets", researchBars, researchRequest.start, researchRequest.end))!;
  deps = { check: async () => ({ status: "ready", requiredVersion: "0.3.58", version: "0.3.58", ruleVersion: "1.5.4", python: "3.14.3" }),
    engine: researchEngine, data: async () => ({ bars: structuredClone(researchBars), source: "financial-datasets", origin: "cache", dataset, attempts: [], asOfDate: researchRequest.end }),
    resolveDataset: loadDataset, save: saveAlphaRun };
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected alpha fixture root.");
  rmSync(root, { recursive: true, force: true });
});

function entries(artifact: AlphaRunArtifact, name = "alpha_backtest", args: object = researchRequest) {
  return [
    { id: "call", type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "alpha-1", name, arguments: args }] } },
    { id: "result", type: "message", message: { role: "toolResult", toolName: name, toolCallId: "alpha-1", details: artifact } },
  ];
}

it("runs through registered tools, archives immutable observations and restores despite newer prices", async () => {
  const tools = createBuiltinTools({ alpha: { run: (input, signal) => runAlphaResearch(input, signal, deps), check: deps.check } });
  expect(tools.filter(tool => tool.name.startsWith("alpha_"))).toHaveLength(3);
  const output = await tools.find(tool => tool.name === "alpha_backtest")!.execute("call", researchRequest);
  const artifact = output.details as AlphaRunArtifact;
  expect(artifact.result.curve.at(-1)!.equity).toBeCloseTo(1027.2503, 8);
  expect(loadAlphaRun(artifact.id)).toEqual(artifact);
  expect(listAlphaRuns().items[0]!.id).toBe(artifact.id);
  await saveBars("AAPL", "financial-datasets", researchBars.map(bar => ({ ...bar, volume: 42 })), researchRequest.start, researchRequest.end);
  const history = await tools.find(tool => tool.name === "alpha_runs")!.execute("history", { id: artifact.id });
  expect(history.details).toEqual(artifact);
  expect(restoreAlphaResearch(artifact.id).result.request.bars[0]!.volume).toBe(10000);
});

it.each(["not-configured", "version", "unavailable", "timeout"] as const)("fails %s before data fetch or storage", async status => {
  let calls = 0;
  deps.check = async () => ({ status, requiredVersion: "0.3.58" });
  deps.data = async () => { calls++; throw new Error("must not fetch"); };
  await expect(runAlphaResearch(researchRequest, undefined, deps)).rejects.toThrow(status);
  expect(calls).toBe(0); expect(listAlphaRuns().items).toEqual([]);
});

it("rejects invalid inputs, changed data and cancellation without creating a run", async () => {
  await expect(runAlphaResearch({ ...researchRequest, fast: 2 }, undefined, deps)).rejects.toThrow();
  const original = deps.resolveDataset; deps.resolveDataset = () => [];
  await expect(runAlphaResearch(researchRequest, undefined, deps)).rejects.toThrow("archived revision");
  deps.resolveDataset = original;
  const controller = new AbortController();
  deps.engine = { run: async request => { const result = await researchEngine.run(request); controller.abort(); return result; } };
  await expect(runAlphaResearch(researchRequest, controller.signal, deps)).rejects.toThrow();
  expect(listAlphaRuns().items).toEqual([]);
});

it("requires explicit assumptions and exposes engine readiness separately from market data", () => {
  const schema = Compile(createBuiltinTools().find(tool => tool.name === "alpha_backtest")!.parameters);
  expect(schema.Check(researchRequest)).toBe(true);
  expect(schema.Check({ ...researchRequest, python: "untrusted-executable" })).toBe(false);
  const { slippage: _slippage, ...incomplete } = researchRequest;
  expect(schema.Check(incomplete)).toBe(false);
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.env = { WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "fixture" };
  const inspect = () => inspectToolReadiness(settings, { market: "US" }, {});
  expect(inspect().find(tool => tool.name === "alpha_backtest")!.status).toBe("blocked");
  expect(inspect().find(tool => tool.name === "alpha_runs")!.status).toBe("local");
  settings.env.WHYJ_QUANT_AKQUANT_PYTHON = "fixture-python";
  expect(inspect().find(tool => tool.name === "alpha_backtest")!.status).toBe("unverified");
});

it("preserves stale origin and refuses empty or unbound observations", async () => {
  const data = await deps.data(researchRequest);
  deps.data = async () => ({ ...data, origin: "stale-cache" });
  expect((await runAlphaResearch(researchRequest, undefined, deps)).origin).toBe("stale-cache");
  for (const invalid of [{ ...data, bars: [] }, { ...data, dataset: undefined }]) {
    deps.data = async () => invalid;
    await expect(runAlphaResearch(researchRequest, undefined, deps)).rejects.toThrow("fixed DatasetRef");
  }
  expect(listAlphaRuns().items).toHaveLength(1);
});

it("rejects forged ledger or research assumptions even when archive hashes are recomputed", async () => {
  const artifact = await runAlphaResearch(researchRequest, undefined, deps);
  const forged = structuredClone(artifact.result); forged.curve[2]!.cash += 1;
  const saved = await saveAlphaRun(artifact.request, forged, "cache");
  expect(() => restoreAlphaResearch(saved.id)).toThrow();
  const wrongRequest = await saveAlphaRun({ ...artifact.request, commission: 0 }, artifact.result, "cache");
  expect(() => restoreAlphaResearch(wrongRequest.id)).toThrow();
  const path = join(resolveAlphaRunsDir(), `${artifact.id}.json`);
  const envelope = JSON.parse(readFileSync(path, "utf8")); envelope.artifact.origin = "provider";
  writeFileSync(path, JSON.stringify(envelope));
  expect(() => loadAlphaRun(artifact.id)).toThrow("integrity");
  expect(listAlphaRuns().unavailable).toContain(`${artifact.id}.json`);
  expect(() => loadAlphaRun("../settings")).toThrow("Invalid alpha run ID");
});

it("verifies reports, history and task evidence while projecting only shareable fields", async () => {
  const artifact = await runAlphaResearch(researchRequest, undefined, deps), lines = entries(artifact);
  const report = buildResearchReport({ lines });
  expect(report.exclusions).toEqual({ unavailableInputs: 0, unverifiedResults: 0, unsupportedResults: 0 });
  expect(report.analyses[0]!.curve!.values.at(-1)).toBeCloseTo(1.0272503, 9);
  const html = renderShareReport(report)!;
  expect(html).toContain("AKQuant SMA(1,2)");
  expect(html).not.toContain(artifact.id); expect(html).not.toContain("888.7889");
  expect(html).not.toContain("order-1"); expect(html).not.toContain("fill-1");
  expect(buildResearchReport({ lines: entries(artifact, "alpha_runs", { id: artifact.id }) }).analyses).toHaveLength(1);
  const declaration = { id: "task", type: "custom_message", customType: "research_task", details: { version: 1, type: "declare", expectedRevision: null,
    task: { id: "alpha-task", request: "Explicit synthetic alpha study", goal: "Check return", scope: { symbols: ["AAPL"], market: "US", start: researchRequest.start, end: researchRequest.end },
      constraints: { allowedTools: ["alpha_backtest"], notes: [] }, dataRefs: [], reportRequired: false,
      criteria: [{ id: "return", description: "Archived return", tool: "alpha_backtest", parameters: researchRequest, metrics: ["Total return"] }] } } };
  const state = projectResearchState([declaration, ...lines], ["alpha_backtest"]);
  expect(state.operations[0]!.recordedScope!.id).toBe(artifact.id);
  expect(state.operations[0]!.status).toBe("verified"); expect(state.task!.status).toBe("complete");
  expect(state.operations[0]!.reason).toContain("engine not rerun");
});

it("excludes mismatched requests, receipts and unavailable original revisions from reports", async () => {
  const artifact = await runAlphaResearch(researchRequest, undefined, deps);
  const wrong = buildResearchReport({ lines: entries(artifact, "alpha_backtest", { ...researchRequest, cash: 2000 }) });
  expect(wrong.analyses).toEqual([]); expect(wrong.exclusions.unverifiedResults).toBe(1);
  const changed = structuredClone(artifact); changed.result.metrics.totalReturn = 99;
  expect(buildResearchReport({ lines: entries(changed) }).analyses).toEqual([]);
  const missing = buildResearchReport({ lines: entries(artifact) }, () => { throw new Error("missing revision"); });
  expect(missing.analyses).toEqual([]); expect(missing.exclusions.unavailableInputs).toBe(1);
  const ref = artifact.result.request.dataset!;
  rmSync(join(root, "data", ref.source, ref.symbol, "revisions", `${ref.revision}.json`));
  expect(() => restoreAlphaResearch(artifact.id)).toThrow("unavailable");
});
