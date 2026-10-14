import { afterEach, beforeEach, expect, it, mock } from "bun:test";
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
import { createQuantResearchAgent } from "../quant-harness.ts";
import { createNewsEvaluationData, newsEvaluationCase } from "../evaluation/news-evaluation.ts";
import { auditCurrentNewsAnswer } from "../evidence/news-answer-evidence.ts";

let root: string, previous: string | undefined, previousProxy: string | undefined;
let server: ReturnType<typeof Bun.serve>, agent: QuantAgentSession | undefined, runtime: AppRuntime | undefined;
let requests: number, newsCalls: number, citationId: string, wrongBasis: boolean;

beforeEach(() => {
  previous = process.env.OHQUANT_DIR; previousProxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-news-answer-session-"));
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  requests = 0; newsCalls = 0; citationId = ""; wrongBasis = true; agent = undefined; runtime = undefined;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    const payload = await incoming.json() as { messages: Array<{ role: string; content: string }> };
    requests++;
    if (requests === 2) {
      const tool = payload.messages.findLast(message => message.role === "tool")!;
      const result = JSON.parse(tool.content.split("\n").at(-1)!) as { citations: Array<{ id: string }> };
      citationId = result.citations[0]!.id;
    }
    if (requests === 3) expect(JSON.stringify(payload)).toContain(citationId);
    const call = requests === 1;
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: "news-basis-call", type: "function",
      function: { name: "research_news", arguments: JSON.stringify(newsEvaluationCase("news-obfuscated").parameters) } }] }
      : { role: "assistant", content: `AAPL ${wrongBasis ? "收盘价非复权价。" : "复权口径未知；计算使用 close。"} [${citationId}/p1]` };
    const chunk = { id: "news-answer-fixture", object: "chat.completion.chunk", created: 0, model: "news-answer-fixture" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.provider = "custom"; settings.model = "news-answer-fixture"; settings.thinkingLevel = "off";
  settings.artifactGeneration.auto = true;
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "synthetic-news-answer-key" } };
  saveSettings(settings);
});

afterEach(async () => {
  agent?.abort(); server.stop(true); await runtime?.shutdown(); await agent?.waitForIdle();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (previousProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previousProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected news answer fixture root");
  rmSync(root, { recursive: true, force: true });
});

it("guards actual Pi news answers and their lossy restart from the persisted branch, preserving original text", async () => {
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  const data = createNewsEvaluationData("news-obfuscated"), loadNews = data.news!;
  data.news = async (request, options) => { newsCalls++; return loadNews(request, options); };
  dependencies.tools = createBuiltinTools({ news: data }).filter(tool => tool.name === "research_news");
  dependencies.loadSkills = async () => [];
  agent = createQuantResearchAgent({ dependencies });
  const messages: UIMessage[][] = [];
  const report = mock(async () => ({ success: true, message: "fixed news report" }));
  runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity: () => {} },
    async () => [], async () => [], () => agent!, report, undefined, 1000, 0);
  await runtime.bootstrap();
  await runtime.submit("分析 AAPL 2026-09-01 至 2026-09-10 的新闻与价格走势");
  expect(requests).toBe(2); expect(newsCalls).toBe(1); expect(report).not.toHaveBeenCalled();
  const original = await agent.getResearchState(), operation = original.operations[0]!;
  expect(operation.requestEntryId).toBe(original.requests.at(-1)!.entryId);
  expect(operation.recordedScope!.price).toMatchObject({ dataset: { adjustment: "provider-unspecified" } });
  expect(messages.at(-1)!.some(message => message.role === "assistant" && message.text?.includes("收盘价非复权价"))).toBe(true);
  expect(messages.at(-1)!.at(-1)!.text).toContain("新闻回答需要复核");
  expect(JSON.stringify(await agent.getSessionEntries())).toContain("收盘价非复权价");

  const metadata = (await agent.getSessionMetadata())!, stored = await dependencies.sessions.open(metadata);
  const tail = await stored.appendMessage({ role: "user", content: "稍后继续", timestamp: 0 });
  await stored.appendCompaction("News details intentionally omitted.", tail, 50000);
  expect(JSON.stringify((await stored.buildContext()).messages)).not.toContain(citationId);
  await runtime.shutdown();
  agent = createQuantResearchAgent({ dependencies });
  await agent.resumeSession(metadata.id);
  runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity: () => {} },
    async () => [], async () => [], () => agent!, report, undefined, 1000, 0);
  await runtime.bootstrap();
  await runtime.submit("恢复 AAPL 的新闻与价格分析，不重新取数");
  expect(requests).toBe(3); expect(newsCalls).toBe(1); expect(report).not.toHaveBeenCalled();
  const recovered = await agent.getResearchState();
  expect(recovered.operations).toEqual(original.operations);
  expect(recovered.requests.at(-1)!.entryId).not.toBe(operation.requestEntryId);
  expect(auditCurrentNewsAnswer(recovered, `收盘价非复权价。[${citationId}/p1]`))
    .toEqual({ status: "audited", violations: ["unsupported-news-price-adjustment"] });
  expect(messages.at(-1)!.at(-1)!.text).toContain("新闻回答需要复核");

  wrongBasis = false;
  await runtime.submit("继续分析 AAPL 新闻价格走势，更正价格口径，不重新取数");
  expect(requests).toBe(4); expect(newsCalls).toBe(1); expect(report).toHaveBeenCalledTimes(1);
  expect((await agent.getResearchState()).operations).toEqual(original.operations);
});
