import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createQuantResearchAgent } from "./quant-harness.ts";
import { createDefaultSessionDependencies } from "../agent/src/session-dependencies.ts";
import type { QuantAgentSession } from "../agent/src/session.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";
import { saveSettings } from "../storage/index.ts";
import { backtestFixture } from "../research/test/fixtures.ts";
import { record } from "../research/references.ts";
import type { ResearchState } from "../research/state.ts";
import type { ResearchTaskSnapshot, ResearchTaskSpec } from "../types/research-task.ts";
import { resumeHandler } from "../cli/handlers/system.ts";
import { AppRuntime } from "../app-runtime.ts";
import { JsonlSessionRepo } from "../agent/src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../agent/src/session-runtime/node.ts";

type Call = { name: string; args: Record<string, unknown> };
type Step = (payload: Record<string, unknown>) => Call;
let root: string, previous: string | undefined, noProxy: string | undefined;
let agent: QuantAgentSession, runtime: AppRuntime | undefined, server: ReturnType<typeof Bun.serve>;
let steps: Step[], requests: Record<string, unknown>[];
let hold: (() => void) | undefined;
const request = "研究 AAPL，2026-01-01 至 2026-02-09，SMA 1/2，零手续费；核验总收益。";
const task: Omit<ResearchTaskSpec, "request"> = { id: "natural-study", goal: "按原窗口和零费用核验 AAPL SMA 收益",
  scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
  constraints: { allowedTools: ["run_backtest"], notes: ["仅研究"] }, dataRefs: [], reportRequired: false,
  criteria: [{ id: "return", description: "归档数据支持总收益", tool: "run_backtest", parameters: { symbol: "AAPL", fast: 1, slow: 2, cash: 1000, commission: 0, start: "2026-01-01", end: "2026-02-09" }, metrics: ["Total return"] }] };

beforeEach(() => {
  previous = process.env.OHQUANT_DIR; noProxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-task-tool-")); process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  steps = []; requests = []; runtime = undefined; hold = undefined;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    const payload = await incoming.json() as Record<string, unknown>; requests.push(payload);
    if (hold) { hold(); return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } }); }
    const call = steps.shift()?.(payload);
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `task-call-${requests.length}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: "仅叙述完成不应改变验收状态" };
    const chunk = { id: "task", object: "chat.completion.chunk", created: 0, model: "task-tool" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "task-tool"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "fixture" } };
  settings.preferences.source = "financial-datasets"; saveSettings(settings);
  agent = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
});
afterEach(async () => {
  runtime?.dispose(); agent.abort(); server.stop(true); await agent.waitForIdle();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected task tool fixture root");
  rmSync(root, { recursive: true, force: true });
});

function details(payload: Record<string, unknown>): { expectedRevision: string; task: ResearchState["task"]; latestRequest: { entryId: string; text: string }; operations: ResearchState["operations"] } {
  const messages = payload.messages as Array<{ role: string; content: string }>;
  const result = messages.findLast(message => message.role === "tool" && typeof message.content === "string" && message.content.includes("\nTask details: "));
  if (!result) throw new Error("Model did not receive task IDs and state in tool content.");
  return JSON.parse(result.content.split("\nTask details: ")[1]!);
}
const read: Step = () => ({ name: "research_task", args: { action: "read" } });
const declare: Step = payload => {
  const state = details(payload);
  return { name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision, requestEntryId: state.latestRequest.entryId, task } };
};

function toolNames(payload: Record<string, unknown>): string[] {
  return (payload.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name).sort();
}

it.each(["headless", "composer"] as const)("declares and verifies an ordinary %s input through actual Pi tool messages", async entry => {
  const fixture = await backtestFixture();
  steps = [read, declare, () => ({ name: "run_backtest", args: fixture.args }), read];
  const messages: unknown[] = [];
  if (entry === "headless") await agent.prompt(request);
  else {
    runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity: () => {} }, async () => [], async () => [], () => agent);
    await runtime.bootstrap(); await runtime.submit(request);
    expect(JSON.stringify(messages)).toContain("Quant.Research");
    expect(JSON.stringify(messages)).toContain("Status: complete");
  }
  expect(steps).toHaveLength(0);
  const state = await agent.getResearchState();
  expect(state.task).toMatchObject({ status: "complete", spec: { ...task, request }, criteria: [{ status: "satisfied" }] });
  expect(state.taskErrors).toEqual([]);
  expect(state.operations[0]!.findings!.metrics[0]!.value).toBeCloseTo(139 / 102 - 1, 12);
  const entryRecord = (await agent.getSessionBranch()).find(item => item.id === state.task!.revision)!;
  expect(record(entryRecord.type === "message" ? entryRecord.message : undefined)?.role).toBe("toolResult");
  expect(details(requests.at(-1)!).task?.status).toBe("complete");
  expect(JSON.stringify(requests[0])).toContain("Research task workflow:");
  expect(toolNames(requests[0]!)).toHaveLength(109);
  for (const payload of requests.slice(2)) expect(toolNames(payload)).toEqual(["research_task", "run_backtest"]);
  const finalSystem = (requests.at(-1)!.messages as Array<{ role: string; content: string }>).find(message => message.role === "system")!.content;
  const instructions = finalSystem.split("Research state (current journal branch")[0]!;
  expect(instructions).toContain("Current active tools: run_backtest, research_task.");
  expect(instructions).not.toMatch(/compute_factor|check_risk|fund_dca_backtest|## Shell execution|Data Tools|Quant Tools/);
  const schema = (requests.at(-1)!.tools as Array<{ function: { name: string; description: string } }>).find(tool => tool.function.name === "run_backtest")!;
  expect(schema.function.description).toBe(agent.state.tools.find(tool => tool.name === "run_backtest")!.description);
  expect(agent.state.tools).toHaveLength(109);
  expect((await agent.getSessionEntries()).filter(item => item.type === "active_tools_change")).toEqual([]);
});

it("accepts a first Pi declaration without task.id and replays the host ID after lossy recovery", async () => {
  const fixture = await backtestFixture();
  let originalRequestId = "";
  steps = [read, payload => {
    const current = details(payload); originalRequestId = current.latestRequest.entryId;
    const proposed: Partial<typeof task> = structuredClone(task); delete proposed.id;
    return { name: "research_task", args: { action: "declare", expectedRevision: current.expectedRevision,
      requestEntryId: originalRequestId, task: proposed } };
  }, () => ({ name: "run_backtest", args: fixture.args }), read];
  await agent.prompt(request);
  const before = (await agent.getResearchState()).task!;
  expect(before).toMatchObject({ status: "complete", spec: { id: `study-${originalRequestId}`, request, goal: task.goal } });
  expect(JSON.stringify(requests[0])).toContain("Optional on the first declaration only");
  const branch = await agent.getSessionBranch();
  const rawDeclare = branch.flatMap(entry => {
    const message = entry.type === "message" ? record(entry.message) : null;
    return message?.role === "assistant" && Array.isArray(message.content)
      ? message.content.map(record).filter(call => call?.name === "research_task" && record(call.arguments)?.action === "declare") : [];
  })[0]!;
  expect(record(record(rawDeclare.arguments)?.task)?.id).toBeUndefined();
  const committed = branch.find(entry => entry.id === before.revision);
  const committedMessage = committed?.type === "message" ? record(committed.message) : null;
  expect(record(record(record(committedMessage?.details)?.event)?.task)?.id).toBe(`study-${originalRequestId}`);

  const metadata = (await agent.getSessionMetadata())!;
  const repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: join(root, "sessions") });
  const stored = await repo.open(metadata);
  const tail = await stored.appendMessage({ role: "user", content: "只保留续问", timestamp: 0 });
  await stored.appendCompaction("有损摘要省略任务 ID 和参数", tail, 50000);
  agent = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  await agent.resumeSession(metadata.id);
  expect((await agent.getResearchState()).task).toEqual(before);

  steps = [read, payload => {
    const current = details(payload), proposed: Partial<typeof task> = structuredClone(task); delete proposed.id;
    return { name: "research_task", args: { action: "declare", expectedRevision: current.expectedRevision,
      requestEntryId: current.latestRequest.entryId, task: proposed } };
  }];
  await agent.prompt("调整原研究任务");
  expect((await agent.getResearchState()).task).toEqual(before);
  expect(JSON.stringify(requests.at(-1))).toContain("A revised task must keep its observed task.id");
});

it("rejects stale declarations and leaves missing acceptance pending despite an assistant completion claim", async () => {
  steps = [read, declare]; await agent.prompt(request);
  const before = (await agent.getResearchState()).task!;
  expect(before.status).toBe("active");
  steps = [read, payload => ({ name: "research_task", args: { action: "declare", expectedRevision: "stale-token",
    requestEntryId: details(payload).latestRequest.entryId, task: { ...task, goal: "stale replacement" } } })];
  await agent.prompt("继续原任务");
  expect((await agent.getResearchState()).task).toEqual(before);
  expect(JSON.stringify(requests.at(-1))).toContain("Stale or invalid task revision");
});

it("expires an initial token when the user request changes before any task was declared", async () => {
  steps = [read]; await agent.prompt(request);
  const previous = details(requests.at(-1)!).expectedRevision;
  steps = [read, payload => {
    const current = details(payload);
    expect(current.task).toBeNull(); expect(current.expectedRevision).not.toBe(previous);
    const next = declare(payload);
    return { ...next, args: { ...next.args, expectedRevision: previous } };
  }];
  await agent.prompt("研究 MSFT，2026-01-01 至 2026-02-09");
  expect((await agent.getResearchState()).task).toBeNull();
  expect(JSON.stringify(requests.at(-1))).toContain("Stale or invalid task revision");
  steps = [read, declare]; await agent.prompt(request);
  expect((await agent.getResearchState()).task?.status).toBe("active");
});

it("keeps cancelled tasks readable and resumes only with a new declaration at the observed revision", async () => {
  const fixture = await backtestFixture();
  steps = [read, declare]; await agent.prompt(request);
  steps = [read, payload => ({ name: "research_task", args: { action: "cancel", expectedRevision: details(payload).task!.revision, reason: "用户结束任务" } }), read];
  await agent.prompt("结束这个任务");
  expect(details(requests.at(-1)!).task?.status).toBe("cancelled");
  expect(toolNames(requests.at(-1)!)).toEqual(["research_task"]);
  steps = [read, declare, () => ({ name: "run_backtest", args: fixture.args }), read];
  await agent.prompt("恢复这个任务，保留原范围和验收条件");
  expect((await agent.getResearchState()).task?.status).toBe("complete");
  expect(toolNames(requests.at(-1)!)).toEqual(["research_task", "run_backtest"]);
});

it("links a real failed call to its matching verified retry without deleting the failure", async () => {
  const fixture = await backtestFixture();
  await agent.waitForIdle();
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  let fail = true;
  agent = createQuantResearchAgent({ dependencies: { ...dependencies, tools: dependencies.tools.map(tool => tool.name !== "run_backtest" ? tool : { ...tool,
    async execute(...args: Parameters<typeof tool.execute>) { if (fail) { fail = false; throw new Error("Fixture provider unavailable"); } return tool.execute(...args); },
  }) } });
  steps = [read, declare, () => ({ name: "run_backtest", args: fixture.args }), () => ({ name: "run_backtest", args: fixture.args }), read,
    payload => {
      const state = details(payload), from = state.operations.find(item => item.status === "failed")!, to = state.operations.find(item => item.status === "verified")!;
      expect(state.task?.status).toBe("blocked");
      return { name: "research_task", args: { action: "resolve", expectedRevision: state.task!.revision, reason: "相同参数重试通过归档核验",
        from: { callEntryId: from.callEntryId, callId: from.callId }, to: { callEntryId: to.callEntryId, callId: to.callId } } };
    }, read];
  await agent.prompt(request);
  const state = await agent.getResearchState();
  expect(state.task?.status).toBe("complete"); expect(state.task?.resolutions[0]?.active).toBe(true);
  expect(state.operations.map(item => item.status)).toEqual(["failed", "verified"]);
  expect(state.unresolved).toEqual([]);
});

it("does not commit a declaration cancelled at tool execution", async () => {
  const controller = new AbortController();
  agent.subscribe(event => { if (event.type === "tool_execution_start" && event.toolName === "research_task" && record(event.args)?.action === "declare") controller.abort(); });
  steps = [read, declare];
  await agent.prompt(request, { signal: controller.signal });
  expect((await agent.getResearchState()).task).toBeNull();
  steps = []; await agent.prompt("仅查看能力");
  expect(toolNames(requests.at(-1)!)).toHaveLength(109);
});

it("recovers a tool-declared task from the original branch after lossy compaction and reopen", async () => {
  const fixture = await backtestFixture();
  steps = [read, declare, () => ({ name: "run_backtest", args: fixture.args })]; await agent.prompt(request);
  const before = (await agent.getResearchState()).task!;
  const metadata = (await agent.getSessionMetadata())!;
  const repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: join(root, "sessions") });
  const stored = await repo.open(metadata);
  const tail = await stored.appendMessage({ role: "user", content: "只留下续问", timestamp: 0 });
  await stored.appendCompaction("省略任务参数和原文", tail, 50000);
  expect(JSON.stringify((await stored.buildContext()).messages)).not.toContain(task.goal);
  agent = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "sessions") }); await agent.resumeSession(metadata.id);
  steps = [read]; await agent.prompt("查看任务和证据");
  expect(details(requests.at(-1)!).task).toEqual(before);
  expect(toolNames(requests.at(-1)!)).toEqual(["research_task", "run_backtest"]);
});

it("expands a new task from the enabled catalog and rederives selection after branch navigation", async () => {
  steps = [read, declare]; await agent.prompt(request);
  const originalLeaf = (await agent.getLeafId())!;
  const nextTask = { ...task, id: "risk-study", goal: "核验风险", constraints: { allowedTools: ["check_risk"], notes: [] },
    criteria: [{ id: "risk", description: "风险", tool: "check_risk", parameters: { symbol: "AAPL" }, metrics: ["Annual volatility"] }] };
  steps = [read, payload => {
    expect(toolNames(payload)).toEqual(["research_task", "run_backtest"]);
    return { name: "research_task", args: { action: "declare", expectedRevision: details(payload).expectedRevision,
      requestEntryId: details(payload).latestRequest.entryId, task: nextTask } };
  }];
  await agent.prompt("改为核验 AAPL 同期风险");
  expect((await agent.getResearchState()).task?.spec.id).toBe("risk-study");
  expect(toolNames(requests.at(-1)!)).toEqual(["check_risk", "research_task"]);
  await agent.navigateTree(originalLeaf); await agent.prompt("回到原回测任务");
  expect(toolNames(requests.at(-1)!)).toEqual(["research_task", "run_backtest"]);
  expect((await agent.getSessionEntries()).filter(item => item.type === "active_tools_change")).toEqual([]);
});

it("keeps unavailable required tools absent after restart without leaking task selection to another session", async () => {
  steps = [read, declare]; await agent.prompt(request);
  const metadata = (await agent.getSessionMetadata())!;
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  agent = createQuantResearchAgent({ dependencies: { ...dependencies, tools: dependencies.tools.filter(tool => tool.name !== "run_backtest") } });
  await agent.resumeSession(metadata.id); steps = [read]; await agent.prompt("继续任务");
  expect(toolNames(requests.at(-1)!)).toEqual(["research_task"]);
  expect((await agent.getResearchState()).task?.status).toBe("blocked");
  const other = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "other-sessions") });
  try {
    await other.prompt("新会话仅列能力"); expect(toolNames(requests.at(-1)!)).toHaveLength(109);
    await agent.prompt("原会话再次确认"); expect(toolNames(requests.at(-1)!)).toEqual(["research_task"]);
  } finally { other.abort(); await other.waitForIdle(); }
});

it("uses an injected tool's current schema description without copying the builtin catalog into its prompt", async () => {
  await agent.waitForIdle();
  const deps = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  let revision = "v1";
  const custom = () => ({ ...deps.tools.find(tool => tool.name === "run_backtest")!, name: "fixture_study", description: `Host-owned study contract ${revision}` });
  agent = createQuantResearchAgent({ dependencies: { ...deps, tools: [custom()], readTools: () => ({ revision, tools: [custom()] }) } });
  await agent.prompt("说明本次能力");
  const first = structuredClone(requests.at(-1)!);
  revision = "v2"; await agent.prompt("查看更新后的能力");
  for (const [payload, expected] of [[first, "v1"], [requests.at(-1)!, "v2"]] as const) {
    expect(toolNames(payload)).toEqual(["fixture_study", "research_task"]);
    const schema = (payload.tools as Array<{ function: { name: string; description: string } }>).find(tool => tool.function.name === "fixture_study")!;
    expect(schema.function.description).toBe(`Host-owned study contract ${expected}`);
    const prompt = (payload.messages as Array<{ role: string; content: string }>).find(message => message.role === "system")!.content;
    expect(prompt).toContain("Current active tools: fixture_study, research_task.");
    expect(prompt).not.toMatch(/run_backtest|compute_factor|check_risk|fetch_bars|## Shell execution/);
    expect(prompt).not.toContain("Host-owned study contract"); // The schema is the description owner.
  }
});

it("narrows skill modes with task tools while retaining the idle registry and dependency observations", async () => {
  await agent.waitForIdle();
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  let revision = "initial", shellObserved = true, preparations = 0;
  const skill = { name: "fixture-research", description: "Scoped fixture", content: "Use only permitted modes.",
    filePath: join(root, "SKILL.md"), sourcePath: root, scope: "project" as const, source: "agents" as const };
  agent = createQuantResearchAgent({ dependencies: { ...dependencies,
    loadSkills: async () => [skill],
    readTools: () => ({ revision, tools: dependencies.tools.filter(tool => revision === "initial" || tool.name !== "run_backtest") }),
    prepareSkills: items => { preparations++; return items.map(item => ({ ...item, readiness: {
      status: shellObserved ? "requirements-met" as const : "blocked" as const, checkedAt: "fixed-observation",
      modes: [{ name: "script", status: shellObserved ? "requirements-met" as const : "blocked" as const,
        requirements: [{ requirement: "shell-execution", status: shellObserved ? "available" as const : "missing" as const, reason: "fixture observation" }] }],
    } })); },
  } });
  let atStart = 0;
  steps = [payload => {
    expect(toolNames(payload)).toHaveLength(109); expect(JSON.stringify(payload.messages)).toContain("Scoped fixture");
    atStart = preparations; shellObserved = false; revision = "removed";
    return read(payload);
  }, declare];
  await agent.prompt(request);
  expect(preparations).toBe(atStart);
  expect(toolNames(requests.at(-1)!)).toEqual(["research_task", "run_backtest"]);
  expect(JSON.stringify(requests.at(-1)!.messages)).not.toContain("Scoped fixture");
  expect(agent.state.tools.some(tool => tool.name === "run_backtest")).toBe(true);
  const branch = await agent.getSessionEntries(), count = requests.length;
  await expect(agent.skill(skill.name)).rejects.toThrow("blocked");
  expect(requests).toHaveLength(count);
  // Idle refresh can persist the new host tool selection, but explicit blocked invocation adds no messages.
  expect((await agent.getSessionEntries()).filter(item => item.type === "message")).toEqual(branch.filter(item => item.type === "message"));
  expect((await agent.getSkills())[0]!.description).toContain("permitted modes: none");
  await agent.prompt("继续原任务并检查缺项");
  expect(toolNames(requests.at(-1)!)).toEqual(["research_task"]);
  expect((await agent.getResearchState()).task?.status).toBe("blocked");
});

it("inspects and refreshes the active task locally even during a model request", async () => {
  const snapshots: ResearchTaskSnapshot[] = [], messages: unknown[] = [];
  let resumes = 0;
  runtime = new AppRuntime({ onMessages: value => messages.push(structuredClone(value)), onActivity: () => {},
    onResearchRequest: value => snapshots.push(value), onResumeRequest: () => { resumes++; } }, async () => [], async () => [], () => agent);
  await runtime.bootstrap(); steps = [read, declare]; await runtime.submit(request);
  const before = await agent.getSessionBranch(), count = requests.length, visible = structuredClone(messages);
  await runtime.submit("/resume --task"); await runtime.submit("/resume --task");
  expect(snapshots).toHaveLength(2); expect(snapshots[0]).toEqual(snapshots[1]);
  expect(snapshots[0]?.task?.status).toBe("active"); expect(snapshots[0]?.task?.criteria[0]?.status).toBe("pending");
  expect(requests).toHaveLength(count); expect(await agent.getSessionBranch()).toEqual(before); expect(messages).toEqual(visible);
  const started = new Promise<void>(resolve => { hold = resolve; });
  const running = runtime.submit("继续研究");
  try {
    await started;
    const busyBranch = await agent.getSessionBranch(), busyMessages = structuredClone(messages);
    await runtime.submit("/resume --task");
    expect(agent.state.isStreaming).toBe(true); expect(requests).toHaveLength(count + 1);
    expect(await agent.getSessionBranch()).toEqual(busyBranch); expect(messages).toEqual(busyMessages);
    expect(snapshots).toHaveLength(3); expect(snapshots[2]?.task).toEqual(snapshots[0]?.task); expect(resumes).toBe(0);
  } finally { agent.abort(); server.stop(true); await running; }
});

it("rejects ambiguous task flags and gives a text snapshot only for an active session", async () => {
  expect((await resumeHandler({ task: true }, [], {})).success).toBe(false);
  const invalid: Array<Record<string, string | number | boolean>> = [{ task: "other" }, { task: true, extra: true }];
  for (const flags of invalid) expect((await resumeHandler(flags, [], { agentSession: agent })).success).toBe(false);
  expect((await resumeHandler({ task: true }, ["other-session"], { agentSession: agent })).success).toBe(false);
  const result = await resumeHandler({ task: true }, [], { agentSession: agent });
  expect(result).toMatchObject({ success: true, renderAs: "text" }); expect(result.message).toContain("No declared research task.");
  expect(requests).toHaveLength(0);
});
