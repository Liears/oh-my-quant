import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Type } from "typebox";
import type { Model } from "@earendil-works/pi-ai";
import { AgentHarness, JsonlSessionRepo, type AgentTool } from "../src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../src/session-runtime/node.ts";

let root: string, server: ReturnType<typeof Bun.serve>, priorNoProxy: string | undefined;
let requests: number, includeAllowed: boolean;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-tool-termination-"));
  priorNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = "127.0.0.1,localhost";
  requests = 0;
  includeAllowed = false;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    await request.json();
    const first = requests++ === 0;
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture" };
    const calls = [{ index: 0, id: "policy-stop", type: "function",
      function: { name: "read_fixed_input", arguments: "{}" } }];
    if (includeAllowed) calls.push({ index: 1, id: "allowed", type: "function",
      function: { name: "read_fixed_input", arguments: "{}" } });
    const delta = first ? { role: "assistant", tool_calls: calls } : { role: "assistant", content: "Continued" };
    const parts = [
      { ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: first ? "tool_calls" : "stop" }] },
    ];
    return new Response(parts.map(part => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } });
  } });
});

afterEach(() => {
  server.stop(true);
  if (priorNoProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = priorNoProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected test directory");
  rmSync(root, { recursive: true, force: true });
});

for (const mixed of [false, true]) test(mixed
  ? "one terminating block in a mixed Pi batch still executes the allowed call and continues"
  : "a policy-blocked tool call can terminate the Pi turn without a second model request", async () => {
  includeAllowed = mixed;
  const env = new NodeExecutionEnv({ cwd: root });
  const session = await new JsonlSessionRepo({ fs: env, sessionsRoot: root }).create({ cwd: root });
  const model: Model<"openai-completions"> = {
    id: "fixture", name: "fixture", api: "openai-completions", provider: "custom",
    baseUrl: `${server.url}v1`, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 1000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  let executed = 0;
  const tool: AgentTool = { name: "read_fixed_input", label: "Fixed input", description: "Read a fixed research input",
    parameters: Type.Object({}), executionMode: "sequential", execute: async () => {
      executed++;
      return { content: [{ type: "text", text: "fixed" }], details: {} };
    } };
  const harness = new AgentHarness({ env, session, model, tools: [tool],
    getApiKeyAndHeaders: async () => ({ apiKey: "fixture-key" }) });
  harness.on("tool_call", event => event.toolCallId === "policy-stop"
    ? { block: true, reason: "Review required before this tool", terminate: true } : undefined);
  await harness.prompt("Inspect the fixed input");
  expect(executed).toBe(mixed ? 1 : 0);
  expect(requests).toBe(mixed ? 2 : 1);
  const messages = (await session.getEntries()).filter(entry => entry.type === "message");
  expect(messages.map(entry => entry.message?.role)).toEqual(mixed
    ? ["system", "displayUser", "assistant", "toolResult", "toolResult", "assistant"]
    : ["system", "displayUser", "assistant", "toolResult"]);
  expect(messages[0]!.message).toMatchObject({ role: "system", toolsAdded: [{ name: "read_fixed_input" }] });
  expect(JSON.stringify(messages)).toContain("Review required before this tool");
}, 5_000);
