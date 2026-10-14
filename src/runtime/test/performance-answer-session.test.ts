import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { AppRuntime } from "../../app-runtime.ts";
import type { QuantAgentSession } from "../../agent/src/session.ts";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import type { UIMessage } from "../../types/ui.ts";
import { saveSettings } from "../../storage/index.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";

let root: string, previous: string | undefined, proxy: string | undefined, answer: string, requests: number;
let server: ReturnType<typeof Bun.serve>, agent: QuantAgentSession | undefined, runtime: AppRuntime | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-performance-answer-"));
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  answer = ""; requests = 0; agent = undefined; runtime = undefined;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    await incoming.json(); requests++;
    const chunk = { id: "method-fixture", object: "chat.completion.chunk", created: 0, model: "method-fixture" };
    return new Response([
      { ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: answer }, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.provider = "custom"; settings.model = "method-fixture"; settings.thinkingLevel = "off";
  settings.artifactGeneration.auto = true;
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "synthetic-method-fixture-key" } };
  saveSettings(settings);
});
afterEach(async () => {
  agent?.abort(); server.stop(true); await runtime?.shutdown(); await agent?.waitForIdle();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected performance fixture root");
  rmSync(root, { recursive: true, force: true });
});

it.each([
  "SPY 的 Sharpe 36.44 源于样本内回撤为零。",
  "VaR 95%、CVaR 95%、最大回撤均为单期（日）符号收益率。",
])("warns on the actual Pi definition and after lossy restart, preserving text: %s", async wrong => {
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  dependencies.tools = []; dependencies.loadSkills = async () => [];
  const messages: UIMessage[][] = [], report = mock(async () => ({ success: true, message: "synthetic report" }));
  const start = async () => {
    runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity: () => {} },
      async () => [], async () => [], () => agent!, report, undefined, 1000, 0);
    await runtime.bootstrap();
  };
  agent = createQuantResearchAgent({ dependencies }); await start(); answer = wrong;
  await runtime!.submit("分析 AAPL 的风险收益");
  expect(requests).toBe(1); expect(report).not.toHaveBeenCalled();
  expect(messages.at(-1)!.some(message => message.role === "assistant" && message.text === wrong)).toBe(true);
  expect(messages.at(-1)!.at(-1)!.text).toContain("绩效口径回答需要复核");
  expect(JSON.stringify(await agent.getSessionEntries())).toContain(wrong);
  const metadata = (await agent.getSessionMetadata())!, stored = await dependencies.sessions.open(metadata);
  const tail = await stored.appendMessage({ role: "user", content: "稍后继续", timestamp: 0 });
  await stored.appendCompaction("Method explanation deliberately omitted.", tail, 50000);
  expect(JSON.stringify((await stored.buildContext()).messages)).not.toContain(wrong);
  await runtime!.shutdown();
  agent = createQuantResearchAgent({ dependencies }); await agent.resumeSession(metadata.id); await start();
  await runtime!.submit("恢复 AAPL 风险收益分析");
  expect(requests).toBe(2); expect(report).not.toHaveBeenCalled();
  expect(messages.at(-1)!.at(-1)!.text).toContain("绩效口径回答需要复核");
  answer = "最大回撤是累计峰谷跌幅；Sharpe 取决于平均超额收益与收益标准差，零回撤不决定 Sharpe。";
  await runtime!.submit("继续分析 AAPL 风险收益，更正定义");
  expect(requests).toBe(3); expect(report).toHaveBeenCalledTimes(1);
});

it("checks supplied weight sums through Pi, preserves the response and suppresses its automatic report", async () => {
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  dependencies.tools = []; dependencies.loadSkills = async () => [];
  agent = createQuantResearchAgent({ dependencies });
  const messages: UIMessage[][] = [], report = mock(async () => ({ success: true, message: "synthetic report" }));
  runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity: () => {} },
    async () => [], async () => [], () => agent!, report, undefined, 1000, 0);
  await runtime.bootstrap();
  answer = "组合约75%与股票风险挂钩（SPY+XLE）。";
  const request = "分析组合 SPY 40%, XLE 25%, TLT 35% 的风险。";
  await runtime.submit(request);
  expect(messages.at(-1)!.some(message => message.role === "assistant" && message.text === answer)).toBe(true);
  expect(messages.at(-1)!.at(-1)!.text).toContain("组合权重回答需要复核");
  expect(report).not.toHaveBeenCalled();
  expect(JSON.stringify(await agent.getSessionEntries())).toContain(answer);
  answer = "组合约65%与股票风险挂钩（SPY+XLE）。";
  await runtime.submit(request);
  expect(report).toHaveBeenCalledTimes(1);
});
