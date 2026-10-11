import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Type } from "typebox";
import { createQuantResearchAgent, QuantResearchHarness } from "./quant-harness.ts";
import { createDefaultSessionDependencies } from "../agent/src/session-dependencies.ts";
import type { QuantAgentDependencies, QuantAgentSession } from "../agent/src/session.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";
import type { ResearchTaskSpec } from "../types/research-task.ts";
import { saveSettings } from "../storage/index.ts";
import { backtestFixture } from "../research/test/fixtures.ts";
import { generateCurrentSessionArtifact } from "./artifact-reports.ts";
import { AppRuntime } from "../app-runtime.ts";
import { JsonlSessionRepo } from "../agent/src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../agent/src/session-runtime/node.ts";

let root: string, previous: string | undefined, noProxy: string | undefined;
let agent: QuantAgentSession | undefined, runtime: AppRuntime | undefined;
let server: ReturnType<typeof Bun.serve>, requests: unknown[];
let toolName: string | null, toolArgs: Record<string, unknown>, hold: boolean, forbiddenCalls: number;
let onRequest: (() => void) | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; noProxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-quant-harness-")); process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  agent = undefined; runtime = undefined; requests = []; toolName = null; hold = false; forbiddenCalls = 0; onRequest = undefined;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    requests.push(await request.json()); onRequest?.();
    if (hold) return new Response(new ReadableStream<Uint8Array>({ start() {} }), { headers: { "content-type": "text/event-stream" } });
    const name = toolName; toolName = null;
    const delta = name ? { role: "assistant", tool_calls: [{ index: 0, id: `call-${requests.length}`, type: "function", function: { name, arguments: JSON.stringify(toolArgs) } }] }
      : { role: "assistant", content: "固定响应不含研究参数，不能用它证明任务完成" };
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 0, model: "task-fixture" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: name ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "task-fixture"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "fixture" } };
  settings.preferences.source = "financial-datasets"; saveSettings(settings);
});
afterEach(async () => {
  runtime?.dispose(); agent?.abort(); server.stop(true); await agent?.waitForIdle();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected Quant Harness fixture root");
  rmSync(root, { recursive: true, force: true });
});

function spec(): ResearchTaskSpec {
  return { id: "runtime-study", request: "以原窗口和零费用回测 AAPL，不执行交易", goal: "核验固定研究任务",
    scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
    constraints: { allowedTools: ["run_backtest"], notes: ["不执行交易"] }, dataRefs: [], reportRequired: false,
    criteria: [{ id: "return", description: "原参数收益", tool: "run_backtest", parameters: { symbol: "AAPL", fast: 1, slow: 2, cash: 1000, commission: 0, start: "2026-01-01", end: "2026-02-09" }, metrics: ["Total return"] }] };
}
function makeAgent(beforeToolCall?: QuantAgentDependencies["beforeToolCall"]) {
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  return createQuantResearchAgent({ dependencies: { ...dependencies, beforeToolCall, tools: [...dependencies.tools,
    { name: "forbidden_probe", label: "Probe", description: "Count executed calls", parameters: Type.Object({}), async execute() {
      forbiddenCalls++; return { content: [{ type: "text", text: "This call must be blocked" }], details: {} };
    } }] } });
}

it.each(["headless", "ui-runtime"] as const)("runs the same fixed research task through %s and records matching report evidence", async entry => {
  const fixture = await backtestFixture(); toolArgs = fixture.args; toolName = "run_backtest";
  const task = spec(); task.reportRequired = true;
  agent = makeAgent();
  const harness = new QuantResearchHarness(agent);
  const messages: unknown[] = [];
  if (entry === "headless") await harness.run(task);
  else {
    runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity: () => {} }, async () => [], async () => [], () => agent!);
    await runtime.bootstrap(); await runtime.submitResearch(task);
    expect(JSON.stringify(messages)).toContain(task.request);
  }
  let state = await harness.getState();
  expect(state.task).toMatchObject({ status: "active", criteria: [{ status: "satisfied" }], reportRef: null });
  expect(state.operations[0]!.findings!.metrics[0]!.value).toBeCloseTo(139 / 102 - 1, 12);
  expect(JSON.stringify(requests[0])).toContain(task.goal);
  expect(JSON.stringify(requests[1])).toContain('\\"status\\":\\"satisfied\\"');
  const report = await generateCurrentSessionArtifact({ agentSession: agent, openFile: () => {} });
  expect(report.success).toBe(true);
  state = await harness.getState(); expect(state.task?.status).toBe("complete"); expect(state.task?.reportRef).toContain("@");
});

it("blocks tools outside the declared capability and instrument scope before execution", async () => {
  agent = makeAgent(); const harness = new QuantResearchHarness(agent);
  toolName = "forbidden_probe"; toolArgs = {};
  await harness.run(spec());
  expect(forbiddenCalls).toBe(0); expect(JSON.stringify(requests.at(-1))).toContain("Tool forbidden_probe not found");
  toolName = "run_backtest"; toolArgs = { symbol: "MSFT", start: "2026-01-01", end: "2026-02-09" };
  const beforeBlocked = requests.length;
  await agent.prompt("尝试其他对象");
  expect(requests).toHaveLength(beforeBlocked + 1);
  expect(JSON.stringify(await agent.getSessionBranch())).toContain("outside the task scope");
  expect((await harness.getState()).task?.status).toBe("blocked");
  const fixture = await backtestFixture(); toolName = "run_backtest"; toolArgs = fixture.args;
  const beforeAllowed = requests.length;
  await agent.prompt("按原任务参数回测");
  expect(requests).toHaveLength(beforeAllowed + 2);
  expect(JSON.stringify(await agent.getSessionBranch())).toContain("Total return");
});

it("applies an injected host tool policy before an otherwise valid research call", async () => {
  const seen: Array<{ name: string; symbol: unknown }> = [];
  agent = makeAgent(call => {
    seen.push({ name: call.toolName, symbol: call.input.symbol });
    return { block: true, reason: "Host policy denied this call.", terminate: true };
  });
  const fixture = await backtestFixture(); toolName = "run_backtest"; toolArgs = fixture.args;
  await new QuantResearchHarness(agent).run(spec());
  expect(seen).toEqual([{ name: "run_backtest", symbol: "AAPL" }]);
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(await agent.getSessionBranch())).toContain("Host policy denied this call.");
});

it("preserves the declaration and missing acceptance after cancellation, then resumes from JSONL and compaction", async () => {
  const fixture = await backtestFixture(); toolArgs = fixture.args;
  agent = makeAgent(); const harness = new QuantResearchHarness(agent), controller = new AbortController();
  hold = true; const started = new Promise<void>(resolve => { onRequest = resolve; });
  const running = harness.run(spec(), null, controller.signal); await started; controller.abort(); await running;
  expect((await harness.getState()).task).toMatchObject({ status: "active", criteria: [{ status: "pending" }] });
  const metadata = (await agent.getSessionMetadata())!, leaf = (await agent.getLeafId())!;
  hold = false; onRequest = undefined; toolName = "run_backtest";
  await agent.prompt("继续原任务");
  expect((await harness.getState()).task?.status).toBe("complete");
  await agent.compact();
  const repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: join(root, "sessions") });
  const stored = await repo.open(metadata);
  const tail = await stored.appendMessage({ role: "user", content: "只保留这条简短续问", timestamp: 0 });
  await stored.appendCompaction("有损摘要省略任务和工具参数", tail, 50000);
  expect(JSON.stringify((await stored.buildContext()).messages)).not.toContain(spec().goal);
  agent = makeAgent(); await agent.resumeSession(metadata.id);
  expect((await agent.getResearchState()).task?.status).toBe("complete");
  await agent.prompt("重建原任务验收状态");
  expect(JSON.stringify(requests.at(-1))).toContain(spec().goal);
  await agent.navigateTree(leaf);
  expect((await agent.getResearchState()).task?.status).toBe("active");
  await agent.prompt("只说明原任务缺项");
  expect(JSON.stringify(requests.at(-1))).toContain("runtime-study");
});

it("rejects stale and cancelled declarations without appending them", async () => {
  agent = makeAgent(); const harness = new QuantResearchHarness(agent);
  await harness.update({ version: 1, type: "declare", expectedRevision: null, task: spec() });
  const entries = await agent.getSessionEntries(), state = await harness.getState();
  await expect(harness.update({ version: 1, type: "declare", expectedRevision: null, task: { ...spec(), goal: "unreviewed change" } })).rejects.toThrow("Stale");
  expect(await agent.getSessionEntries()).toEqual(entries);
  const controller = new AbortController(); controller.abort();
  await expect(harness.update({ version: 1, type: "cancel", expectedRevision: state.task!.revision, reason: "cancel" }, controller.signal)).rejects.toThrow();
  expect(await agent.getSessionEntries()).toEqual(entries);
});

it("keeps the submitted instruction and acceptance snapshot when the caller mutates its input", async () => {
  const fixture = await backtestFixture(); toolArgs = fixture.args; toolName = "run_backtest";
  agent = makeAgent(); const harness = new QuantResearchHarness(agent), task = spec();
  const running = harness.run(task);
  task.request = "MUTATED OUTSIDE REQUEST"; task.criteria = [];
  const state = await running;
  expect(state.task?.spec.request).toBe(spec().request);
  expect(state.task?.status).toBe("complete");
  expect(JSON.stringify(requests)).not.toContain("MUTATED OUTSIDE REQUEST");
});

it("does not start a model request when cancellation arrives during prompt preparation", async () => {
  const controller = new AbortController();
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  dependencies.prompts.turn = input => { controller.abort(); return input; };
  agent = createQuantResearchAgent({ dependencies });
  const harness = new QuantResearchHarness(agent);
  await harness.run(spec(), null, controller.signal).catch(() => {});
  expect(requests).toHaveLength(0);
  expect((await harness.getState()).task?.status).toBe("active");
});

it("uses the newly declared task scope instead of a previous instrument hint", async () => {
  agent = makeAgent(); await agent.waitForIdle();
  agent.updateContext({ lastSymbol: "MSFT", lastMarket: "US", lastStartDate: "2020-01-01", lastEndDate: "2020-02-01" });
  await new QuantResearchHarness(agent).update({ version: 1, type: "declare", expectedRevision: null, task: spec() });
  await agent.prompt("继续这项研究");
  expect(JSON.stringify(requests[0])).not.toContain("2020-01-01");
  expect(JSON.stringify(requests[0])).not.toContain("MSFT");
  expect(JSON.stringify(requests[0])).toContain("2026-02-09");
});
