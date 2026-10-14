import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { saveSettings } from "../../storage/index.ts";
import { calculateWeightedScoreTool } from "../../tools/weighted-score-tool.ts";
import { createSkillWorkflowReader, runSkillEvaluation, skillEvaluationCase, stageSkillEvaluation } from "../evaluation/skill-evaluation.ts";

type Payload = { messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>; tools: Array<{ function: { name: string; parameters: unknown } }> };
const fixture = skillEvaluationCase("skill-risk-fear-score"), originalInput = fixture.weightedScore!;
const correct = "用户提供的 AURX 合成 Fear Score，报告2026-09-18，观察2026-09-17。Composite72/100，threshold70；加权合计72.25。VIX21.4 score60、IV rank78、RSI29 score80、Volume anomaly2.3x score75、Put/Call1.4 score70、连续下跌4天 score65。IV rank贡献最大19.50；RSI贡献16.00。缺失实时资料、财报和流动性，仅只读，本次未进行外部查询或修改。";
let root: string, previous: string | undefined, proxy: string | undefined, workflow: string;
let server: ReturnType<typeof Bun.serve>, requests: Payload[], answer: string, calculation: unknown, skipCalculation: boolean;

beforeEach(() => {
  previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-weighted-score-session-")); process.env.OHQUANT_DIR = root;
  process.env.NO_PROXY = "127.0.0.1,localhost"; requests = []; answer = correct;
  calculation = structuredClone(originalInput); skipCalculation = false;
  workflow = stageSkillEvaluation("skill-risk-fear-score", join(import.meta.dir, "./fixtures/skills"), root).workflowFile;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    const payload = await incoming.json() as Payload; requests.push(payload);
    const call = requests.length === 1 ? { name: "bash", args: { command: `Get-Content -Raw -LiteralPath '${workflow}'` } }
      : requests.length === 2 && !skipCalculation ? { name: calculateWeightedScoreTool.name, args: calculation } : null;
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `weighted-${requests.length}`, type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { role: "assistant", content: answer };
    const chunk = { id: "weighted", object: "chat.completion.chunk", created: 0, model: "weighted-test" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "weighted-test"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "synthetic-weighted-key" } }; saveSettings(settings);
});

afterEach(() => {
  server.stop(true);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  const within = relative(realpathSync(tmpdir()), realpathSync(root));
  if (!within.startsWith("whyj-weighted-score-session-") || within.includes(sep)) throw new Error("Unsafe weighted score fixture cleanup");
  rmSync(root, { recursive: true, force: true });
});

async function evaluate() {
  const reader = createSkillWorkflowReader(workflow, fixture.workflow);
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions"),
    skillPaths: [join(root, "skills", "LLMQuant-skills")] });
  dependencies.tools = [reader.tool, calculateWeightedScoreTool];
  return runSkillEvaluation("skill-risk-fear-score", dependencies, reader.trace, { timeoutMs: 30000 });
}

test("actual Pi skill preflight, pinned workflow and production score receipt reach the next request", async () => {
  const report = await evaluate();
  expect(report.passed).toBe(true);
  expect(report.checks).toHaveLength(11);
  expect(report.requests).toBe(3);
  expect(report.toolCalls.map(call => call.name)).toEqual(["bash", "calculate_weighted_score"]);
  expect(requests[0]!.tools.map(tool => tool.function.name)).toContain("calculate_weighted_score");
  const receipt = JSON.stringify(requests[2]!.messages);
  expect(receipt).toContain("explicit-supplied-score-components");
  expect(receipt).toContain("72.25"); expect(receipt).toContain("19.5");
  expect(report.knownClaimViolations).toEqual([]);
});

test("correct arithmetic cannot turn the retained RSI ranking error into a passing skill answer", async () => {
  answer = correct.replace("IV rank贡献最大19.50；RSI贡献16.00", "RSI贡献最大16.00；IV rank贡献19.50");
  const report = await evaluate();
  expect(report.passed).toBe(false);
  expect(report.knownClaimViolations).toEqual(["wrong-weighted-score-largest-contributor"]);
  expect(report.answers[0]!.text).toBe(answer);
  expect(report.checks.find(check => check.name.includes("receives exactly"))?.passed).toBe(true);
});

test("a valid calculation with substituted weights fails original-input binding even if prose is correct", async () => {
  const changed = structuredClone(originalInput); changed.components[1]!.weight = 0.1; changed.components[2]!.weight = 0.35;
  calculation = changed;
  const report = await evaluate();
  expect(report.passed).toBe(false);
  expect(report.checks.find(check => check.name.includes("receives exactly"))?.passed).toBe(false);
  expect(report.checks.find(check => check.name.includes("receipt returns"))?.passed).toBe(true);
});

test("reordered original components stay bound to the same supplied input", async () => {
  calculation = { ...structuredClone(originalInput), components: [...originalInput.components].reverse() };
  expect((await evaluate()).passed).toBe(true);
});

test("an answer without the required calculation cannot reuse a fabricated receipt", async () => {
  skipCalculation = true;
  const report = await evaluate();
  expect(report.passed).toBe(false);
  expect(report.checks.find(check => check.name.includes("receives exactly"))?.passed).toBe(false);
  expect(report.checks.find(check => check.name.includes("receipt returns"))?.passed).toBe(false);
  expect(report.requests).toBe(2);
});

test("invalid tool input is rejected by Pi schema validation and does not produce arithmetic evidence", async () => {
  calculation = { ...structuredClone(originalInput), components: [{ name: "RSI", score: "unknown", weight: 1 }] };
  const report = await evaluate();
  expect(report.passed).toBe(false);
  expect(report.toolFailures).toHaveLength(1);
  expect(report.checks.find(check => check.name.includes("receipt returns"))?.passed).toBe(false);
});
