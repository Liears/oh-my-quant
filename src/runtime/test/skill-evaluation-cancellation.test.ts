import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { isCompleteEvaluationAnswer } from "../evaluation/evaluation-answers.ts";
import { createSkillWorkflowReader, runSkillEvaluation, stageSkillEvaluation } from "../evaluation/skill-evaluation.ts";

// Include cold Pi/skill initialization in the deadline without assuming that a
// hosted Windows runner can reach the provider in 250 ms. The fixture must stay
// stalled beyond the assertion budget so a missing abort still fails the test.
const DEADLINE_MS = 2_000;
const COMPLETION_BUDGET_MS = 8_000;
const STALL_MS = 10_000;
const TEST_TIMEOUT_MS = 15_000;

let root: string, previous: string | undefined, proxy: string | undefined;
let server: ReturnType<typeof Bun.serve>, requests: number, delayResponse: boolean, callWorkflow: boolean;
let onRequest: () => void;
let timers: Array<ReturnType<typeof setTimeout>>;
let staged: ReturnType<typeof stageSkillEvaluation>;

beforeEach(() => {
  previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-skill-cancellation-"));
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  staged = stageSkillEvaluation("skill-risk-health", join(import.meta.dir, "./fixtures/skills"), root);
  requests = 0; delayResponse = false; callWorkflow = false; onRequest = () => {}; timers = [];
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    await incoming.json(); requests++; onRequest();
    const call = callWorkflow && requests === 1;
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: "workflow-1", type: "function",
      function: { name: "bash", arguments: JSON.stringify({ command: `Get-Content -Raw -LiteralPath '${staged.workflowFile}'` }) } }] }
      : { role: "assistant", content: "Synthetic answer; no completed financial evaluation is claimed." };
    const chunk = { id: "cancellation", object: "chat.completion.chunk", created: 0, model: "cancellation-test" };
    const body = [{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
    if (!delayResponse) return new Response(body, { headers: { "content-type": "text/event-stream" } });
    // A bounded stalled stream makes the missing-abort regression fail without hanging the suite.
    return new Response(new ReadableStream({ start(controller) {
      const timer = setTimeout(() => { controller.enqueue(new TextEncoder().encode(body)); controller.close(); }, STALL_MS);
      timers.push(timer);
    } }), { headers: { "content-type": "text/event-stream" } });
  } });
});

afterEach(() => {
  for (const timer of timers) clearTimeout(timer);
  server.stop(true);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected skill cancellation root");
  rmSync(root, { recursive: true, force: true });
});

function setup() {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.provider = "custom"; settings.model = "cancellation-test"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "synthetic-cancellation-key" } };
  const deps = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions"), settings,
    skillPaths: [join(root, "skills", "LLMQuant-skills")] });
  const reader = createSkillWorkflowReader(staged.workflowFile, staged.fixture.workflow);
  deps.tools = [reader.tool];
  return { deps, reader };
}

test("skill deadline interrupts a stalled real Pi provider stream", async () => {
  delayResponse = true;
  const { deps, reader } = setup();
  const report = await runSkillEvaluation("skill-risk-health", deps, reader.trace, { timeoutMs: DEADLINE_MS });
  expect(report.outcome).toBe("timeout"); expect(report.passed).toBe(false);
  expect(requests).toBe(1); expect(report.requests).toBe(1);
  expect(report.durationMs).toBeLessThan(COMPLETION_BUDGET_MS); expect(report.answers.some(isCompleteEvaluationAnswer)).toBe(false);
}, TEST_TIMEOUT_MS);

test("external cancellation interrupts a stalled real Pi provider stream", async () => {
  delayResponse = true;
  const controller = new AbortController(); onRequest = () => { timers.push(setTimeout(() => controller.abort(), 50)); };
  const { deps, reader } = setup();
  const report = await runSkillEvaluation("skill-risk-health", deps, reader.trace, { signal: controller.signal, timeoutMs: 3000 });
  expect(report.outcome).toBe("cancelled"); expect(report.passed).toBe(false);
  expect(requests).toBe(1); expect(report.requests).toBe(1);
  expect(report.durationMs).toBeLessThan(COMPLETION_BUDGET_MS); expect(report.answers.some(isCompleteEvaluationAnswer)).toBe(false);
}, TEST_TIMEOUT_MS);

test("pre-cancelled skill evaluation makes no provider request", async () => {
  const controller = new AbortController(); controller.abort();
  const { deps, reader } = setup();
  const report = await runSkillEvaluation("skill-risk-health", deps, reader.trace, { signal: controller.signal });
  expect(report.outcome).toBe("cancelled"); expect(report.passed).toBe(false);
  expect(requests).toBe(0); expect(report.requests).toBe(0); expect(reader.trace.reads).toHaveLength(0);
});

test("request limit stops before the second real provider request after a workflow read", async () => {
  callWorkflow = true;
  const { deps, reader } = setup();
  const report = await runSkillEvaluation("skill-risk-health", deps, reader.trace, { maxRequests: 1 });
  expect(report.outcome).toBe("request-limit"); expect(report.passed).toBe(false);
  expect(requests).toBe(1); expect(report.requests).toBe(1);
  expect(reader.trace.reads.map(read => read.status)).toEqual(["accepted"]);
  expect(report.answers.some(isCompleteEvaluationAnswer)).toBe(false);
});

test("skill deadline reaches an executing workflow tool without another provider request", async () => {
  callWorkflow = true;
  const { deps, reader } = setup();
  let entered = false, aborted = false;
  const execute = reader.tool.execute;
  reader.tool.execute = async (id, args, signal, update) => {
    entered = true;
    await new Promise<void>((done, reject) => {
      const abort = () => { aborted = true; clearTimeout(timer); reject(signal?.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); done(); }, STALL_MS);
      timers.push(timer); signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    return execute(id, args, signal, update);
  };
  const report = await runSkillEvaluation("skill-risk-health", deps, reader.trace, { timeoutMs: DEADLINE_MS });
  expect(report.outcome).toBe("timeout"); expect(report.passed).toBe(false);
  expect(entered).toBe(true); expect(aborted).toBe(true);
  expect(requests).toBe(1); expect(reader.trace.reads).toHaveLength(0);
  expect(report.durationMs).toBeLessThan(COMPLETION_BUDGET_MS);
}, TEST_TIMEOUT_MS);
