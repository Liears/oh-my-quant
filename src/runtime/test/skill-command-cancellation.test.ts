import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";
import type { QuantAgentSession } from "../../agent/src/session-contracts.ts";
import { skillHandler } from "../../cli/handlers/skill.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";

let root: string, previous: string | undefined, proxy: string | undefined;
let server: ReturnType<typeof Bun.serve>, agent: QuantAgentSession;
let requests: number, delayed: boolean, onRequest: () => void;
let timers: Array<ReturnType<typeof setTimeout>>;
const routes = [["run", "command-fixture", "Use supplied text"], ["trigger", "command-fixture", "Use supplied text"],
  ["command-fixture", "Use supplied text"]];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-skill-command-cancel-"));
  previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  const path = join(root, ".agents", "skills", "command-fixture");
  mkdirSync(join(root, ".git")); mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), "---\nname: command-fixture\ndescription: Synthetic command fixture\n---\nUse supplied text only; no market or account access.");
  requests = 0; delayed = true; timers = []; onRequest = () => {};
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    await incoming.json(); requests++; onRequest();
    const chunk = { id: "command-cancel", object: "chat.completion.chunk", created: 0, model: "command-cancel-test" };
    const body = [{ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "Synthetic completed answer." }, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
    if (!delayed) return new Response(body, { headers: { "content-type": "text/event-stream" } });
    return new Response(new ReadableStream({ start(controller) {
      timers.push(setTimeout(() => { controller.enqueue(new TextEncoder().encode(body)); controller.close(); }, 1200));
    } }), { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.provider = "custom"; settings.model = "command-cancel-test"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "synthetic-command-key" } };
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions"), settings, skillPaths: [path] });
  dependencies.tools = [];
  agent = createQuantResearchAgent({ dependencies });
});

afterEach(async () => {
  agent.abort(); await agent.waitForIdle();
  for (const timer of timers) clearTimeout(timer);
  server.stop(true);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe skill command cleanup");
  rmSync(root, { recursive: true, force: true });
});

test.each(routes)("pre-cancelled text skill route %j makes no real Pi request", async (...route) => {
  const controller = new AbortController(); controller.abort();
  let error: unknown;
  try { await skillHandler({}, route, { agentSession: agent, commandSignal: controller.signal }); }
  catch (caught) { error = caught; }
  expect(requests).toBe(0); expect(error).toBe(controller.signal.reason);
  expect(agent.state.messages.some(message => message.role === "assistant" && message.stopReason === "stop")).toBe(false);
});

test.each(routes)("cancelling text skill route %j interrupts Pi and cannot return command success", async (...route) => {
  const controller = new AbortController(); onRequest = () => { timers.push(setTimeout(() => controller.abort(), 50)); };
  const started = performance.now(); let error: unknown, succeeded = false;
  try { succeeded = (await skillHandler({}, route, { agentSession: agent, commandSignal: controller.signal })).success; }
  catch (caught) { error = caught; }
  expect(requests).toBe(1); expect(performance.now() - started).toBeLessThan(1000);
  expect(succeeded).toBe(false); expect(error).toBe(controller.signal.reason);
  expect(agent.state.isStreaming).toBe(false);
  expect(agent.state.messages.some(message => message.role === "assistant" && message.stopReason === "stop")).toBe(false);
});

test("an uncancelled text skill still completes normally through the command and real Pi loop", async () => {
  delayed = false;
  const result = await skillHandler({}, routes[0]!, { agentSession: agent, commandSignal: new AbortController().signal });
  expect(result.success).toBe(true); expect(requests).toBe(1);
  expect(agent.state.messages.some(message => message.role === "assistant" && message.stopReason === "stop")).toBe(true);
});
