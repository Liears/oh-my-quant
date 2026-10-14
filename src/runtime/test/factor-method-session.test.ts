import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { AppRuntime } from "../../app-runtime.ts";
import type { QuantAgentSession } from "../../agent/src/session.ts";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";
import { createBuiltinTools } from "../../tools/registry.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import type { UIMessage } from "../../types/ui.ts";
import { saveSettings } from "../../storage/index.ts";
import { createEvaluationPriceData, researchEvaluationCase, runResearchEvaluation } from "../evaluation/research-evaluation.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";

const fixture = researchEvaluationCase("stock-factors");
const complete = "Factor          Period  Latest\n──────────\nmomentum        2       -0.0948905109\nreversal        2       0.0948905109\nvolatility      2       0.0768968339\nvolume_ratio    20      1\nrsi             14      48.1481481481\nsma_deviation   20      0.0407766990";
const wrong = complete.replace("48.1481481481", "100");
let root: string, previous: string | undefined, proxy: string | undefined;
let server: ReturnType<typeof Bun.serve>, agent: QuantAgentSession | undefined, runtime: AppRuntime | undefined;
let requests: number, answer: string, recoveryAnswer: string | null, inputs: string[];

beforeEach(() => {
  previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-factor-session-")); process.env.OHQUANT_DIR = root;
  process.env.NO_PROXY = "127.0.0.1,localhost"; requests = 0; inputs = []; agent = undefined; runtime = undefined;
  answer = complete; recoveryAnswer = null;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    const payload = await incoming.json() as { messages: Array<{ role: string; content: string }> };
    requests++; inputs.push(JSON.stringify(payload.messages));
    let call: { name: string; args: Record<string, unknown> } | undefined;
    if (requests === 1) call = { name: "research_task", args: { action: "read" } };
    if (requests === 2) {
      const result = payload.messages.findLast(item => item.role === "tool" && item.content.includes("\nTask details: "))!;
      const state = JSON.parse(result.content.split("\nTask details: ")[1]!);
      call = { name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision,
        requestEntryId: state.latestRequest.entryId, task: { id: "six-factors", goal: "Verify six factors", scope: {
          symbols: fixture.symbols, market: fixture.market, start: fixture.start, end: fixture.end },
          constraints: { allowedTools: ["compute_factor"], notes: [] }, dataRefs: [], reportRequired: false,
          criteria: fixture.required.map((item, index) => ({ id: `criterion-${index}`, description: "Latest", ...item })) } } };
    }
    if (requests >= 3 && requests <= 8) call = { name: "compute_factor", args: fixture.required[requests - 3]!.parameters };
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `factor-${requests}`, type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: requests >= 10 && recoveryAnswer !== null ? recoveryAnswer : answer };
    const chunk = { id: "factor", object: "chat.completion.chunk", created: 0, model: "factor-test" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "factor-test"; settings.thinkingLevel = "off";
  settings.artifactGeneration.auto = true;
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "synthetic-factor-key" } }; saveSettings(settings);
});
afterEach(async () => {
  agent?.abort(); server.stop(true); await runtime?.shutdown(); await agent?.waitForIdle();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected factor fixture root");
  rmSync(root, { recursive: true, force: true });
});
function dependencies() {
  const deps = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  deps.tools = createBuiltinTools({ analysisData: createEvaluationPriceData("stock-factors") }).filter(tool => tool.name === "compute_factor");
  deps.loadSkills = async () => [];
  return deps;
}

test.each(["correct", "wrong-research", "wrong-recovery", "omitted-recovery"] as const)("six-factor evaluation keeps real tool evidence and checks %s after lossy restart", async scenario => {
  if (scenario === "wrong-research") { answer = wrong; recoveryAnswer = complete; }
  if (scenario === "wrong-recovery") recoveryAnswer = wrong;
  if (scenario === "omitted-recovery") recoveryAnswer = complete.split("\n").slice(0, -1).join("\n");
  const report = await runResearchEvaluation("stock-factors", dependencies(), { maxRequests: 16 });
  expect(report.operations).toHaveLength(6); expect(report.task?.status).toBe("complete");
  expect(report.checks.find(check => check.name === "independent arithmetic expectations")!.passed).toBe(true);
  expect(report.checks.find(check => check.name === "lossy recovery preserves task and avoids recomputation")!.passed).toBe(true);
  expect(requests).toBe(10); expect(report.answers).toHaveLength(2); expect(report.passed).toBe(scenario === "correct");
  if (scenario.startsWith("wrong")) expect(report.knownClaimViolations).toEqual([
    { phase: scenario === "wrong-research" ? "research" : "recovery", code: "wrong-verified-factor-latest" }]);
  else expect(report.knownClaimViolations).toEqual([]);
  if (scenario === "omitted-recovery") expect(report.checks.filter(check => !check.passed).map(check => check.name))
    .toEqual(["recovery: all six factor Latest values explicitly quoted with periods"]);
});

test.each(["research", "recovery"] as const)("actual runtime preserves the wrong RSI text and pauses report generation in %s", async phase => {
  const deps = dependencies(); agent = createQuantResearchAgent({ dependencies: deps });
  const messages: UIMessage[][] = [], report = mock(async () => ({ success: true, message: "synthetic report" }));
  const start = async () => {
    runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity: () => {} },
      async () => [], async () => [], () => agent!, report, undefined, 1000, 0);
    await runtime.bootstrap();
  };
  await start(); answer = phase === "research" ? wrong : complete;
  await runtime!.submit(fixture.prompt);
  const original = structuredClone((await agent.getResearchState()).operations);
  expect(original).toHaveLength(6); expect(report).toHaveBeenCalledTimes(phase === "research" ? 0 : 1);
  const metadata = (await agent.getSessionMetadata())!, stored = await deps.sessions.open(metadata);
  const tail = await stored.appendMessage({ role: "user", content: "稍后继续", timestamp: 0 });
  await stored.appendCompaction("Factor values deliberately omitted.", tail, 50000);
  await runtime!.shutdown(); agent = createQuantResearchAgent({ dependencies: deps }); await agent.resumeSession(metadata.id); await start();
  answer = phase === "recovery" ? wrong : complete;
  await runtime!.submit("恢复 AAPL 已完成的六因子分析，保留日期与各因子周期，不重新计算。");
  expect(requests).toBe(10); expect(report).toHaveBeenCalledTimes(1);
  expect((await agent.getResearchState()).operations).toEqual(original);
  expect(messages.flat().some(message => message.role === "assistant" && message.text === wrong)).toBe(true);
  expect(messages.flat().some(message => message.text?.includes("最新因子值与已核验工具结果不一致"))).toBe(true);
  expect((await agent.getSessionEntries()).some(entry => entry.type === "message" && entry.message.role === "assistant"
    && entry.message.content.some(part => part.type === "text" && part.text === wrong))).toBe(true);
  expect(inputs[9]).toContain("Wilder");
  answer = complete; await runtime!.submit("更正 AAPL 因子分析中 RSI 的 Latest 后继续。");
  expect(requests).toBe(11); expect(report).toHaveBeenCalledTimes(2);
});

test("runtime audits a close-count explanation even when no Latest value is present", async () => {
  agent = createQuantResearchAgent({ dependencies: dependencies() });
  const messages: UIMessage[][] = [], report = mock(async () => ({ success: true, message: "synthetic report" }));
  runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity: () => {} },
    async () => [], async () => [], () => agent!, report, undefined, 1000, 0);
  await runtime.bootstrap();
  answer = "momentum(2) 至少需要 2 个连续收盘价。";
  await runtime.submit(fixture.prompt);
  expect(messages.at(-1)!.some(message => message.role === "assistant" && message.text === answer)).toBe(true);
  expect(messages.at(-1)!.at(-1)!.text).toContain("N+1 个收盘价观察");
  expect(report).not.toHaveBeenCalled();
  answer = "momentum(2) 至少需要 3 个连续收盘价。";
  await runtime.submit("继续分析 AAPL 因子，更正观察数");
  expect(report).toHaveBeenCalledTimes(1);
});
