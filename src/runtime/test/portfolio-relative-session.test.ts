import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { AppRuntime } from "../../app-runtime.ts";
import type { QuantAgentSession } from "../../agent/src/session.ts";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";
import { createBuiltinTools } from "../../tools/registry.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import type { UIMessage } from "../../types/ui.ts";
import { saveSettings } from "../../storage/index.ts";
import { createEvaluationPortfolioData, portfolioEvaluationCase } from "../evaluation/research-evaluation-portfolio.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";

let root: string, previous: string | undefined, proxy: string | undefined;
let server: ReturnType<typeof Bun.serve>, agent: QuantAgentSession | undefined, runtime: AppRuntime | undefined;
let requests: number, answer: string, inputs: string[];
let fixture: ReturnType<typeof portfolioEvaluationCase>;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-relative-session-")); process.env.OHQUANT_DIR = root;
  process.env.NO_PROXY = "127.0.0.1,localhost"; requests = 0; inputs = []; agent = undefined; runtime = undefined;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    const payload = await incoming.json() as { messages: Array<{ role: string; content: string }> };
    requests++; inputs.push(JSON.stringify(payload.messages));
    let call: { name: string; args: Record<string, unknown> } | undefined;
    if (requests === 1) call = { name: "research_task", args: { action: "read", benchmark: "SPY" } };
    if (requests === 2) {
      const result = payload.messages.findLast(item => item.role === "tool" && item.content.includes("\nTask details: "))!;
      const state = JSON.parse(result.content.split("\nTask details: ")[1]!);
      call = { name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision,
        requestEntryId: state.latestRequest.entryId, task: { id: "relative-task", goal: "Compare Core and Stable", scope: {
          symbols: fixture.symbols, market: fixture.market, start: fixture.start, end: fixture.end, ...fixture.comparisonScope },
          constraints: { allowedTools: ["compare_portfolios"], notes: [] }, dataRefs: [], reportRequired: false,
          criteria: fixture.required.map((item, index) => ({ id: `criterion-${index}`, description: "Required metrics", ...item })) } } };
    }
    if (requests === 3) call = { name: "compare_portfolios", args: fixture.required[0]!.parameters };
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `relative-${requests}`, type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { role: "assistant", content: answer };
    const chunk = { id: "relative", object: "chat.completion.chunk", created: 0, model: "relative-test" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "relative-test"; settings.thinkingLevel = "off";
  settings.artifactGeneration.auto = true;
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "synthetic-relative-key" } }; saveSettings(settings);
});
afterEach(async () => {
  agent?.abort(); server.stop(true); await runtime?.shutdown(); await agent?.waitForIdle();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected relative fixture root");
  rmSync(root, { recursive: true, force: true });
});

test.each(["research", "recovery"] as const)("actual runtime flags relative contradiction in %s and preserves evidence after lossy restart", async phase => {
  const comparison = createEvaluationPortfolioData(); fixture = portfolioEvaluationCase();
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  dependencies.tools = createBuiltinTools({ comparison }).filter(tool => ["list_portfolios", "compare_portfolios"].includes(tool.name));
  dependencies.loadSkills = async () => [];
  const messages: UIMessage[][] = [], report = mock(async () => ({ success: true, message: "synthetic report" }));
  const start = async () => {
    runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity: () => {} },
      async () => [], async () => [], () => agent!, report, undefined, 1000, 0);
    await runtime.bootstrap();
  };
  const wrong = "Stable 与基准收益持平（0% vs +19.5%）。", correct = "Core 跑赢基准；Stable 落后于基准。";
  agent = createQuantResearchAgent({ dependencies }); await start(); answer = phase === "research" ? wrong : correct;
  await runtime!.submit(fixture.prompt);
  expect(requests).toBe(4);
  expect((await agent.getResearchState()).task?.status).toBe("complete");
  expect(report).toHaveBeenCalledTimes(phase === "research" ? 0 : 1);
  if (phase === "research") expect(messages.at(-1)!.at(-1)!.text).toContain("相对基准的收益方向");
  const id = (await agent.getResearchState()).operations[0]!.comparison!.id;
  const path = join(root, "benchmark", "comparisons", "portfolios", `${id}.json`), original = readFileSync(path, "utf8");
  const metadata = (await agent.getSessionMetadata())!, stored = await dependencies.sessions.open(metadata);
  const tail = await stored.appendMessage({ role: "user", content: "稍后继续", timestamp: 0 });
  await stored.appendCompaction("Comparison details deliberately omitted.", tail, 50000);
  expect(JSON.stringify((await stored.buildContext()).messages)).not.toContain(id);
  await runtime!.shutdown(); agent = createQuantResearchAgent({ dependencies }); await agent.resumeSession(metadata.id); await start();
  answer = phase === "recovery" ? wrong : correct; await runtime!.submit("恢复 Core 与 Stable 的组合研究。");
  expect(requests).toBe(5); expect(report).toHaveBeenCalledTimes(1);
  if (phase === "recovery") expect(messages.at(-1)!.at(-1)!.text).toContain("相对基准的收益方向");
  for (const payload of [inputs[3]!, inputs[4]!]) {
    expect(payload).toContain("Portfolio A vs benchmark SPY: total return 39% vs 19.5%; excess return 19.5 pp; outperformed.");
    expect(payload).toContain("Portfolio B vs benchmark SPY: total return 0% vs 19.5%; excess return -19.5 pp; underperformed.");
  }
  expect(messages.flat().some(message => message.role === "assistant" && message.text === wrong)).toBe(true);
  expect(JSON.stringify(await agent.getSessionEntries())).toContain(wrong);
  expect(readFileSync(path, "utf8")).toBe(original);
  answer = correct; await runtime!.submit("更正组合收益比较并继续。");
  expect(requests).toBe(6); expect(report).toHaveBeenCalledTimes(2);
});
