import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { createAgent, type QuantAgentSession } from "../src/session.ts";
import { createDefaultSessionDependencies } from "../src/session-dependencies.ts";
import { JsonlSessionRepo } from "../src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../src/session-runtime/node.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { artifactReference, resolveArtifactsDir, saveArtifact, saveSettings } from "../../storage/index.ts";
import { backtestFixture, portfolioFixture, researchMessages } from "../../research/test/fixtures.ts";
import { formatResearchContext } from "../../research/state.ts";
import type { ResearchTaskSpec } from "../../types/research-task.ts";
import type { ReportProvenance } from "../../types/research-evidence.ts";

let root: string, previous: string | undefined, noProxy: string | undefined;
let server: ReturnType<typeof Bun.serve>;
let mode: "text" | "tool" | "hold";
let onRequest: (() => void) | undefined;
let requests: Array<{ messages: unknown[] }>;
let agent: QuantAgentSession | undefined;
let repo: JsonlSessionRepo;
let toolArgs: Record<string, unknown>;

beforeEach(() => {
  previous = process.env.OHQUANT_DIR; noProxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-research-recovery-")); process.env.OHQUANT_DIR = root;
  process.env.NO_PROXY = "127.0.0.1,localhost";
  mode = "text"; requests = []; agent = undefined; onRequest = undefined;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    requests.push(await request.json() as { messages: unknown[] });
    onRequest?.();
    if (mode === "hold") return new Response(new ReadableStream<Uint8Array>({ start() {} }), { headers: { "content-type": "text/event-stream" } });
    const tool = mode === "tool" && requests.length === 1;
    const delta = tool ? { role: "assistant", tool_calls: [{ index: 0, id: "live-research", type: "function", function: { name: "run_backtest", arguments: JSON.stringify(toolArgs) } }] }
      : { role: "assistant", content: "摘要未保留研究细节" };
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 0, model: "research-fixture" };
    const events = [{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] }];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.provider = "custom"; settings.model = "research-fixture"; settings.thinkingLevel = "off";
  settings.providers = { custom: { api: "openai-completions", baseUrl: `${server.url}v1`, apiKey: "synthetic-test-key" } };
  settings.preferences.source = "financial-datasets"; saveSettings(settings);
  repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: join(root, "sessions") });
});
afterEach(async () => {
  agent?.abort(); server.stop(true); await agent?.waitForIdle();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected recovery fixture");
  rmSync(root, { recursive: true, force: true });
});

it("injects freshly verified tool findings into the next actual Pi provider request and persists original user text", async () => {
  const fixture = await backtestFixture(); toolArgs = fixture.args; mode = "tool";
  agent = createAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  await agent.prompt("按既定费用假设回测 AAPL，不执行交易");
  expect(requests).toHaveLength(2);
  const state = await agent.getResearchState();
  expect(state.operations[0]).toMatchObject({ status: "verified", tool: "run_backtest", parameters: fixture.args });
  expect(state.requests[0]!.text).toBe("按既定费用假设回测 AAPL，不执行交易");
  const secondRequest = JSON.stringify(requests[1]);
  expect(secondRequest).toContain("Research state (current journal branch");
  expect(secondRequest).toContain('\\"status\\":\\"verified\\"');
  expect(secondRequest).toContain(state.operations[0]!.callEntryId);
  expect(secondRequest).toContain(String(state.operations[0]!.references[0]!.ref.revision));
  const before = state.operations;
  const result = await agent.compact();
  expect(result.summary).toContain("摘要未保留研究细节");
  expect((await agent.getResearchState()).operations).toEqual(before);
});

it("rebuilds group versions, report references and pending work after lossy compaction, restart and branch changes", async () => {
  const fixture = await portfolioFixture(), session = await repo.create({ cwd: root });
  const entryIds: string[] = [];
  for (const message of fixture.messages) entryIds.push(await session.appendMessage(message));
  const pending = researchMessages("check_risk", { symbol: "MSFT", start: "2024-01-02", end: "2025-01-02" });
  const call = pending[1]!;
  if (call.role === "assistant" && call.content[0]?.type === "toolCall") call.content[0].id = "unfinished-risk";
  await session.appendMessage(call);
  await session.appendCustomMessageEntry("artifact_export", "Saved original report", false, { reportRef: "original-report-version", title: "原组合报告",
    provenance: { leafId: entryIds[2], entryHash: "original-source-hash" } });
  const tail = await session.appendMessage({ role: "user", content: "继续", timestamp: 3 });
  await session.appendCompaction("摘要遗漏了组合、参数、待办和报告。", tail, 50000);
  const metadata = await session.getMetadata(), compactedLeaf = await session.getLeafId();
  // The model message projection really has dropped the source facts.
  expect(JSON.stringify((await session.buildContext()).messages)).not.toContain("recorded-group-revision");
  agent = createAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  await agent.resumeSession(metadata.id);
  const restored = await agent.getResearchState();
  expect(restored.operations[0]).toMatchObject({ status: "verified", comparison: { id: fixture.artifact.id,
    portfolioRevision: "recorded-group-revision", benchmark: "SPY", groups: [{ name: "原始观察组", weights: { AAPL: 0.7, MSFT: 0.3 } }, {}] } });
  expect(restored.unresolved).toMatchObject([{ callId: "unfinished-risk", tool: "check_risk", capabilityAvailable: true }]);
  expect(restored.reports[0]).toMatchObject({ reportRef: "original-report-version", sourceLeafId: entryIds[2] });
  await agent.prompt("刚才那组和这个报告还有什么没做？");
  const payload = JSON.stringify(requests.at(-1));
  for (const value of ["recorded-group-revision", "原始观察组", "original-report-version", "unfinished-risk", "2024-01-02", "SPY"]) expect(payload).toContain(value);
  const beforeFailedResume = await agent.getResearchState();
  await expect(agent.resumeSession("missing")).rejects.toThrow("not found");
  expect(await agent.getResearchState()).toEqual(beforeFailedResume);
  // Selecting a user entry moves to its parent: this is now the empty root branch.
  await agent.navigateTree(entryIds[0]!);
  expect((await agent.getResearchState()).operations).toEqual([]);
  expect((await agent.getResearchState()).reports).toEqual([]);
  await agent.prompt("新的研究，不沿用原组合");
  expect(JSON.stringify(requests.at(-1))).not.toContain("recorded-group-revision");
  await agent.navigateTree(compactedLeaf!);
  expect((await agent.getResearchState()).operations).toEqual(restored.operations);
  agent.reset(); await agent.waitForIdle();
  expect((await agent.getResearchState()).operations).toEqual([]);
});

it("keeps the current task's earlier report metadata in the resumed Pi request", async () => {
  const fixture = await backtestFixture(), session = await repo.create({ cwd: root });
  const task: ResearchTaskSpec = { id: "report-study", request: "核对 AAPL 收益并保存报告", goal: "核对收益与报告",
    scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
    constraints: { allowedTools: ["run_backtest"], notes: [] }, dataRefs: [], reportRequired: true,
    criteria: [{ id: "return", description: "核对总收益", tool: "run_backtest", parameters: fixture.args, metrics: ["Total return"] }] };
  await session.appendCustomMessageEntry("research_task", "Declared task", false,
    { version: 1, type: "declare", expectedRevision: null, task });
  for (const message of fixture.messages) await session.appendMessage(message);
  const source = await session.getBranch();
  const sourceHash = createHash("sha256").update(JSON.stringify(source)).digest("hex");
  const provenance: ReportProvenance = { version: 1, sessionHash: sourceHash, scope: "branch", leafId: source.at(-1)!.id,
    entryIds: source.map(entry => entry.id), entryHash: sourceHash, datasets: [] };
  const saved = saveArtifact((await session.getMetadata()).id, "<html>task report</html>", {
    title: "最初的收益报告", messageCount: source.length, provenance,
  });
  const reportRef = artifactReference(saved);
  const verifyReport = createDefaultSessionDependencies({ cwd: root }).verifyReport!;
  expect(verifyReport(reportRef, { ...provenance })).toBe(true);
  expect(verifyReport(reportRef, { ...provenance, sessionHash: "different-source" })).toBe(false);
  const reportEntryId = await session.appendCustomMessageEntry("artifact_export", "Saved task report", false, {
    reportRef, title: "最初的收益报告", provenance,
  });
  for (let index = 0; index < 4; index++) await session.appendCustomMessageEntry("artifact_restore", "Opened another report", false, {
    reportRef: `other-report-${index}`, title: `其它报告 ${index}`, provenance: { leafId: `foreign-${index}`, entryHash: "foreign-source" },
  });
  await session.appendCustomMessageEntry("artifact_restore", "Opened a foreign copy", false, {
    reportRef, title: "同引用的外来标题", provenance: { leafId: "foreign-copy", entryHash: "foreign-source" },
  });
  const tail = await session.appendMessage({ role: "user", content: "继续", timestamp: 3 });
  await session.appendCompaction("摘要没有保存报告标题或原研究数值。", tail, 50000);
  agent = createAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  await agent.resumeSession((await session.getMetadata()).id);
  const restored = await agent.getResearchState();
  expect(restored.task).toMatchObject({ status: "complete", reportRef, reportEntryId, reportAvailable: true });
  expect(restored.reports).toHaveLength(6);
  const context = formatResearchContext(restored);
  const snapshot = JSON.parse(context.slice(context.indexOf('{"version"'))) as {
    reports: { items: Array<{ entryId: string; title: string; taskBound: boolean }> };
  };
  expect(snapshot.reports.items.find(report => report.entryId === reportEntryId)).toMatchObject({ title: "最初的收益报告", taskBound: true });
  expect(snapshot.reports.items.find(report => report.title === "同引用的外来标题")?.taskBound).toBe(false);
  await agent.prompt("这个已验收任务的报告叫什么？");
  const payload = JSON.stringify(requests.at(-1));
  expect(payload).toContain(reportRef);
  expect(payload).toContain("最初的收益报告");
  expect(payload).toContain(reportEntryId);
  expect(payload).toContain('\\"taskBound\\":true');
  unlinkSync(join(resolveArtifactsDir(), ".revisions", saved.sessionId, saved.revision!, "report.json"));
  const unavailable = await agent.getResearchState();
  expect(unavailable.task).toMatchObject({ status: "blocked", reportRef, reportEntryId, reportAvailable: false,
    reasons: ["Recorded task report version is unavailable or damaged."] });
  await agent.prompt("报告文件还可用吗？");
  expect(JSON.stringify(requests.at(-1))).toContain('\\"reportAvailable\\":false');
});

it("does not publish a partial compaction or lose evidence when the summary request is cancelled", async () => {
  const fixture = await backtestFixture(), session = await repo.create({ cwd: root });
  for (const message of fixture.messages) await session.appendMessage(message);
  agent = createAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  await agent.resumeSession((await session.getMetadata()).id);
  const before = await agent.getResearchState(), entries = await agent.getSessionEntries();
  mode = "hold";
  const requested = new Promise<void>(resolve => { onRequest = resolve; });
  const compacting = agent.compact().then(() => "completed", () => "cancelled");
  await requested;
  agent.abort();
  expect(await compacting).toBe("cancelled");
  await agent.waitForIdle();
  expect(await agent.getSessionEntries()).toEqual(entries);
  expect(await agent.getResearchState()).toEqual(before);
  mode = "text";
  await agent.prompt("继续原来的研究");
  expect(JSON.stringify(requests.at(-1))).toContain(String(before.operations[0]!.references[0]!.ref.revision));
});
