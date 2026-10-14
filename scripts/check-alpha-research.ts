import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createQuantResearchAgent } from "../src/runtime/quant-harness.ts";
import { DEFAULT_SETTINGS } from "../src/types/config.ts";
import { saveSettings, saveBars, listAlphaRuns } from "../src/storage/index.ts";
import { researchRequest, researchBars } from "../src/alpha/test/fixtures/research.ts";
import { buildResearchReport } from "../src/research/input.ts";
import { generateArtifact } from "../src/artifact/src/generator.ts";

// Real Pi and AKQuant; deterministic local model transport and synthetic cached observations.
if (process.argv.length !== 4 || process.argv[2] !== "--python") throw new Error("Usage: bun run scripts/check-alpha-research.ts --python <python executable>");
const root = mkdtempSync(join(tmpdir(), "whyj-alpha-live-"));
const previous = { root: process.env.OHQUANT_DIR, proxy: process.env.NO_PROXY };
process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
let sequence = 0;
let calls: Array<{ name: string; args: object }> = [
  { name: "alpha_engine_status", args: {} }, { name: "alpha_backtest", args: researchRequest },
];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  await request.json();
  const call = calls.shift();
  const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `alpha-${++sequence}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
    : { role: "assistant", content: "Synthetic local transport completed." };
  const header = { id: "alpha", object: "chat.completion.chunk", created: 0, model: "alpha-fixture" };
  return new Response([{ ...header, choices: [{ index: 0, delta, finish_reason: null }] },
    { ...header, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
    .map(value => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
} });
const settings = structuredClone(DEFAULT_SETTINGS);
settings.provider = "custom"; settings.model = "alpha-fixture"; settings.thinkingLevel = "off";
settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "fixture" } };
settings.preferences.source = "financial-datasets";
settings.env.WHYJ_QUANT_AKQUANT_PYTHON = resolve(process.argv[3]!);
saveSettings(settings);
const agent = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
const resumed = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
try {
  await saveBars("AAPL", "financial-datasets", researchBars, researchRequest.start, researchRequest.end);
  await agent.prompt(`Use AKQuant alpha_backtest with these explicit hypothetical assumptions: ${JSON.stringify(researchRequest)}`);
  assert.equal(calls.length, 0);
  const state = await agent.getResearchState();
  assert.deepEqual(state.operations.map(operation => operation.status), ["recorded", "verified"]);
  assert.equal(listAlphaRuns().items.length, 1);
  const runId = listAlphaRuns().items[0]!.id;
  const branch = await agent.getSessionBranch();
  const report = buildResearchReport({ lines: branch });
  assert.ok(Math.abs(report.analyses[0]!.curve!.values.at(-1)! - 1.0272503) < 1e-8);
  const metadata = (await agent.getSessionMetadata())!;
  const generated = generateArtifact({ sessionPath: metadata.path, leafId: await agent.getLeafId() });
  assert.ok(generated?.html.includes("AKQuant SMA(1,2)"));
  assert.equal(generated!.provenance.datasets.length, 1);
  await resumed.resumeSession(metadata.id);
  assert.equal((await resumed.getResearchState()).operations[1]!.status, "verified");
  calls = [{ name: "alpha_runs", args: { id: runId } }];
  await resumed.prompt("Read the saved alpha run and verify its original receipts.");
  assert.equal((await resumed.getResearchState()).operations.at(-1)!.status, "verified");
  assert.equal(listAlphaRuns().items.length, 1);
  console.log(JSON.stringify({ status: "passed", transport: "local fixture", engine: "real AKQuant 0.3.58", tools: 3,
    finalEquity: 1027.2503, report: "verified", restart: "verified", history: "verified", data: "synthetic fixed cache" }));
} finally {
  agent.abort(); resumed.abort(); server.stop(true); await Promise.all([agent.waitForIdle(), resumed.waitForIdle()]);
  if (previous.root === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous.root;
  if (previous.proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previous.proxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected alpha check root.");
  rmSync(root, { recursive: true, force: true });
}
