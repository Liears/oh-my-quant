import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";
import type { QuantAgentSession } from "../../agent/src/session.ts";
import { AppRuntime } from "../../app-runtime.ts";
import type { UIMessage } from "../../types/ui.ts";
import { annualComparisonFixture } from "../../research/test/annual-fixture.ts";
import { createBuiltinTools } from "../../tools/registry.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { loadSettings, saveSettings } from "../../storage/index.ts";
import { listAnnualReports } from "../research/annual-reports.ts";
import { ANNUAL_EVALUATION_TOOLS, createAnnualEvaluationFixture, runAnnualEvaluation, type AnnualEvaluationFixture } from "../evaluation/annual-evaluation.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";

let root: string, previous: string | undefined, proxy: string | undefined;
let server: ReturnType<typeof Bun.serve>, fixture: AnnualEvaluationFixture, requests: number;
let steps: string[], mode: "normal" | "hold" | "loop" | "narrative", wrongSelection: boolean, narrative: string, decisionRead: boolean;
let firstAnswer: "stop" | "length" | "empty", recoveryNarrative: string | undefined;
let preparedInstructions: string[];
beforeEach(async () => {
  previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-annual-evaluation-")); process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  fixture = createAnnualEvaluationFixture((await annualComparisonFixture()).save()); requests = 0;
  steps = ["comparison", "decision", "generate", "answer", "restore", "answer"]; mode = "normal"; wrongSelection = false; decisionRead = false;
  narrative = "Fixed transport fixture; interpretation requires separate review.";
  firstAnswer = "stop"; recoveryNarrative = undefined;
  preparedInstructions = [];
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    const payload = await incoming.json() as { messages: Array<{ role: string; content: string }> }; requests++;
    preparedInstructions.push(JSON.stringify(payload.messages));
    if (mode === "hold") return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
    const step = mode === "loop" ? "decision" : mode === "narrative" ? "answer" : steps.shift();
    if (step === "decision") decisionRead = true;
    const id = listAnnualReports().items[0]?.id;
    if (step === "restore") {
      expect(JSON.stringify(payload.messages)).toContain(id!);
      expect(JSON.stringify(payload.messages)).toContain(fixture.selected.hash);
      if (decisionRead) expect(JSON.stringify(payload.messages)).toContain(fixture.selected.decision.recordedAt);
    }
    const call = step === "comparison" ? { name: "portfolio_comparisons", args: { id: fixture.comparisonId } }
      : step === "decision" ? { name: "research_decisions", args: { action: "read", id: fixture.selected.decision.id } }
      : step === "generate" ? { name: "annual_report", args: { ...fixture.args, ...(wrongSelection ? { decision_ids: [fixture.other.decision.id] } : {}) } }
      : step === "restore" ? { name: "annual_reports", args: { id } } : null;
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `annual-eval-${requests}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: firstAnswer === "empty" && requests === 4 ? "" : `${requests > 4 && recoveryNarrative !== undefined ? recoveryNarrative : narrative}\nReport: ${id ?? "absent"}\nDecision: ${fixture.selected.decision.id}` };
    const chunk = { id: "annual-evaluation", object: "chat.completion.chunk", created: 0, model: "annual-test" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : firstAnswer === "length" && requests === 4 ? "length" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "annual-test"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "SYNTHETIC_ANNUAL_SECRET" } }; saveSettings(settings);
});
afterEach(() => {
  server.stop(true);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected annual evaluation fixture");
  rmSync(root, { recursive: true, force: true });
});
function dependencies() {
  const result = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  result.tools = createBuiltinTools().filter(tool => (ANNUAL_EVALUATION_TOOLS as readonly string[]).includes(tool.name)); result.loadSkills = async () => [];
  return result;
}

test("actual annual tools and Pi preserve exact decisions and original HTML through lossy restart", async () => {
  const result = await runAnnualEvaluation(fixture, dependencies());
  expect(result.passed).toBe(true); expect(result.checks).toHaveLength(9); expect(result.requests).toBe(6);
  expect(result.answers.map(answer => answer.phase)).toEqual(["research", "recovery"]);
  expect(result.artifact?.decisionHashes).toEqual([{ id: fixture.selected.decision.id, hash: fixture.selected.hash }]);
  expect(result.artifact?.html).not.toContain(fixture.other.decision.id);
  expect(result.audit.toolTrace.filter(trace => trace.type === "call").map(trace => trace.tool)).toEqual(["portfolio_comparisons", "research_decisions", "annual_report", "annual_reports"]);
  expect(result.audit.preparedRequests).toHaveLength(6);
  expect(result.audit.preparedRequests.some(request => request.phase === "recovery")).toBe(true);
  expect(result.reviewRequired).toContain("not a semantic accuracy score");
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC_ANNUAL_SECRET"); expect(JSON.stringify(result)).not.toContain(String(server.url));
});

test("actual Pi requests and lossy recovery do not instruct alpha labels for excess return", async () => {
  const result = await runAnnualEvaluation(fixture, dependencies());
  expect(result.passed).toBe(true); expect(preparedInstructions).toHaveLength(6);
  for (const request of preparedInstructions) {
    expect(request).not.toContain("α for benchmark/excess");
    expect(request).not.toContain("α benchmark/excess");
    expect(request).toContain("EXCESS (pp)");
  }
});

test("newer unselected decision cannot pass by merely producing a valid annual file", async () => {
  wrongSelection = true;
  const result = await runAnnualEvaluation(fixture, dependencies());
  expect(result.outcome).toBe("finished"); expect(result.passed).toBe(false);
  expect(result.checks.find(check => check.name.startsWith("one report"))?.passed).toBe(false);
  expect(result.checks.find(check => check.name.startsWith("saved evidence"))?.passed).toBe(false);
  expect(result.artifact?.decisionHashes?.[0]?.id).toBe(fixture.other.decision.id);
});

test.each(["research", "recovery"] as const)("rejects the retained Sharpe cause in %s while preserving all report bindings", async phase => {
  const wrong = "SPY 的 Sharpe 36.44 源于样本内回撤为零，是描述性估计而非能力证据。";
  const correct = "Sharpe 取决于样本平均超额收益和收益标准差；零回撤不决定 Sharpe。";
  narrative = phase === "research" ? wrong : correct;
  recoveryNarrative = phase === "recovery" ? wrong : correct;
  const result = await runAnnualEvaluation(fixture, dependencies());
  expect(result.checks.every(check => check.passed)).toBe(true);
  expect(result.knownClaimViolations).toEqual([{ phase, code: "wrong-sharpe-zero-drawdown-causality" }]);
  expect(result.passed).toBe(false);
});

test.each(["research", "recovery"] as const)("rejects the retained alpha table label in %s without changing report bindings", async phase => {
  const wrong = "组别      成员  总回报   CAGR    Sharpe  DD       α\ncore     AAPL  20.00%  20.14%  0.56    -18.18%  +5pp\ngrowth   MSFT  10.00%  10.07%  0.78    -5.00%   -5pp\nα·SPY    SPY   15.00%  15.10%  36.44   0.00%    基准";
  const correct = "超额收益 +5 个百分点，是总收益与基准总收益之差，不是风险调整 alpha。";
  narrative = phase === "research" ? wrong : correct;
  recoveryNarrative = phase === "recovery" ? wrong : correct;
  const result = await runAnnualEvaluation(fixture, dependencies());
  expect(result.checks.every(check => check.passed)).toBe(true);
  expect(result.knownClaimViolations).toEqual([{ phase, code: "excess-return-labelled-alpha" }]);
  expect(result.passed).toBe(false);
});

test.each(["research", "recovery"] as const)("actual runtime warns on annual alpha in %s and keeps immutable evidence through restart", async phase => {
  const wrong = "| 组合 | 总回报 | α |\n| Core | 20% | +5pp |", correct = "Core 超额收益 +5pp，不是风险调整 alpha。";
  narrative = phase === "research" ? wrong : correct;
  recoveryNarrative = phase === "recovery" ? wrong : correct;
  const settings = loadSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  const deps = dependencies(), messages: UIMessage[][] = [], report = mock(async () => ({ success: true, message: "synthetic report" }));
  let agent: QuantAgentSession = createQuantResearchAgent({ dependencies: deps }), runtime: AppRuntime | undefined;
  const start = async () => {
    runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity: () => {} },
      async () => [], async () => [], () => agent, report, undefined, 1000, 0);
    await runtime.bootstrap();
  };
  try {
    await start(); await runtime!.submit(fixture.prompt + "\n请分析年报收益。");
    const id = listAnnualReports().items[0]!.id;
    const original = readFileSync(join(root, "reports", "annual", `${id}.json`), "utf8");
    expect(report).toHaveBeenCalledTimes(phase === "research" ? 0 : 1);
    if (phase === "research") expect(messages.at(-1)!.at(-1)!.text).toContain("年报回答需要复核");
    const metadata = (await agent.getSessionMetadata())!, stored = await deps.sessions.open(metadata);
    const tail = await stored.appendMessage({ role: "user", content: "稍后继续", timestamp: 0 });
    await stored.appendCompaction("Annual details deliberately omitted.", tail, 50000);
    expect(JSON.stringify((await stored.buildContext()).messages)).not.toContain(id);
    await runtime!.shutdown();
    agent = createQuantResearchAgent({ dependencies: deps }); await agent.resumeSession(metadata.id); await start();
    await runtime!.submit("恢复并分析组合年报收益。");
    expect(report).toHaveBeenCalledTimes(1);
    if (phase === "recovery") expect(messages.at(-1)!.at(-1)!.text).toContain("年报回答需要复核");
    expect(messages.flat().some(message => message.role === "assistant" && message.text?.includes(wrong))).toBe(true);
    expect(JSON.stringify(await agent.getSessionEntries())).toContain(wrong.split("\n")[0]);
    expect(readFileSync(join(root, "reports", "annual", `${id}.json`), "utf8")).toBe(original);
    expect(listAnnualReports().items).toHaveLength(1);
    recoveryNarrative = correct;
    await runtime!.submit("更正并分析组合年报收益。");
    expect(report).toHaveBeenCalledTimes(2);
  } finally {
    agent.abort(); await runtime?.shutdown(); await agent.waitForIdle();
  }
});

test("generation without the explicitly requested reads fails the workflow gate", async () => {
  steps = ["generate", "answer", "restore", "answer"];
  const result = await runAnnualEvaluation(fixture, dependencies());
  expect(result.passed).toBe(false);
  expect(result.checks.find(check => check.name.startsWith("original comparison"))?.passed).toBe(false);
});

test("narrative alone and a missing selected journal cannot be counted as a successful report", async () => {
  mode = "narrative";
  const narrativeResult = await runAnnualEvaluation(fixture, dependencies());
  expect(narrativeResult.passed).toBe(false); expect(narrativeResult.artifact).toBeNull(); expect(listAnnualReports().items).toHaveLength(0);
  mode = "normal"; steps = ["comparison", "decision", "generate", "answer"];
  unlinkSync(join(root, "research", "decisions", `${fixture.selected.decision.id}.json`));
  const missing = await runAnnualEvaluation(fixture, dependencies());
  expect(missing.passed).toBe(false); expect(missing.artifact).toBeNull();
  expect(missing.audit.toolTrace.some(trace => trace.type === "result" && trace.isError)).toBe(true);
});

test("mechanical success explicitly retains even a false narrative for separate semantic review", async () => {
  narrative = "Synthetic deliberately false answer: this is verified real-account profit with complete trading history.";
  const result = await runAnnualEvaluation(fixture, dependencies());
  expect(result.passed).toBe(true);
  expect(result.answers.every(answer => answer.text.includes(narrative))).toBe(true);
  expect(result.reviewRequired).toContain("real account performance are not verified");
});

test.each(["length", "empty"] as const)("successful recovery cannot hide the first answer ending with %s", async ending => {
  firstAnswer = ending;
  const result = await runAnnualEvaluation(fixture, dependencies());
  expect(result.passed).toBe(false);
  expect(result.outcome).toBe(ending === "length" ? "request-failed" : "no-final-answer");
  expect(result.answers[0]).toMatchObject({ phase: "research", stopReason: ending === "length" ? "length" : "stop", hasError: false });
  expect(result.answers[0]!.text).toBe(ending === "empty" ? "" : `${narrative}\nReport: ${result.artifact!.id}\nDecision: ${fixture.selected.decision.id}`);
  expect(result.answers[1]).toMatchObject({ phase: "recovery", stopReason: "stop", hasError: false });
  expect(result.checks.filter(check => !check.passed).map(check => check.name)).toEqual(["research: finished answer cites the report and selected decision for separate semantic review"]);
});

test("request limits, timeout and unsafe tool composition fail without opening extra capabilities", async () => {
  mode = "loop";
  const limited = await runAnnualEvaluation(fixture, dependencies(), { maxRequests: 2 });
  expect(limited.outcome).toBe("request-limit"); expect(limited.passed).toBe(false); expect(requests).toBe(2);
  mode = "hold";
  const timed = await runAnnualEvaluation(fixture, dependencies(), { timeoutMs: 100 });
  expect(timed.outcome).toBe("timeout"); expect(timed.passed).toBe(false);
  const deps = dependencies(); deps.tools = createBuiltinTools();
  await expect(runAnnualEvaluation(fixture, deps)).rejects.toThrow("isolated annual tools");
  await expect(runAnnualEvaluation(fixture, dependencies(), { maxRequests: 0 })).rejects.toThrow("Invalid evaluation limits");
});
