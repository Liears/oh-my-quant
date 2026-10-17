import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Type } from "typebox";
import type { ImageContent } from "@earendil-works/pi-ai";
import { createAgent, type QuantAgentDependencies, type QuantAgentSession } from "../src/session.ts";
import { JsonlSessionRepo } from "../src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../src/session-runtime/node.ts";
import { buildResearchReport } from "../../research/input.ts";

const image: ImageContent = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=" };
let root: string, priorProxy: string | undefined, priorSkills: string | undefined;
let server: ReturnType<typeof Bun.serve>, agent: QuantAgentSession | undefined, deps: QuantAgentDependencies;
let requests: unknown[], vision: boolean, mode: "plain" | "tool" | "hold" | "error", failAuth: boolean;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-chart-session-"));
  priorProxy = process.env.NO_PROXY; process.env.NO_PROXY = "127.0.0.1,localhost";
  priorSkills = process.env.OHQUANT_SKILLS_DIR; process.env.OHQUANT_SKILLS_DIR = root;
  requests = []; vision = true; mode = "plain"; failAuth = false; agent = undefined;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json(); requests.push(body);
    if (mode === "hold") return new Response(new ReadableStream<Uint8Array>({ start() {} }), { headers: { "content-type": "text/event-stream" } });
    if (mode === "error") return new Response("Fixture transport failure", { status: 400 });
    const tool = mode === "tool" && requests.length === 1;
    const delta = tool ? { role: "assistant", tool_calls: [{ index: 0, id: "fixture-call", type: "function", function: { name: "bash", arguments: "{}" } }] }
      : { role: "assistant", content: "Chart fixture received" };
    const common = { id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-vision" };
    return new Response([{ ...common, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...common, choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] }]
      .map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const env = new NodeExecutionEnv({ cwd: root });
  deps = { env, sessions: new JsonlSessionRepo({ fs: env, sessionsRoot: join(root, "sessions") }),
    tools: [{ name: "bash", label: "Fixture local resources", description: "Synthetic resource read; never executes a shell", parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: "Fixture reference" }], details: {} }) }],
    readConnection: () => ({ model: { id: "fixture-vision", name: "Fixture", api: "openai-completions", provider: "custom", baseUrl: `${server.url}v1`,
      reasoning: false, input: vision ? ["text", "image"] : ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 },
      thinkingLevel: "off", compactTriggerTokens: 100000, getAuth: async () => { if (failAuth) throw new Error("Fixture authentication failure"); return { apiKey: "fixture" }; } }),
    loadSkills: async () => [{ name: "technical-analyst", description: "Chart fixture", content: "Read the attached weekly chart. Do not execute FMP scripts.",
      filePath: join(root, "tradermonty-claude-trading-skills", "skills", "technical-analyst", "SKILL.md"), sourcePath: root, source: "pi", scope: "project" }],
    prompts: { system: () => "Fixture chart research", turn: text => text, skill: (_name, extra) => extra ?? "" },
    verifyResearch: buildResearchReport };
});
afterEach(async () => {
  agent?.abort(); server.stop(true); await agent?.waitForIdle();
  if (priorProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = priorProxy;
  if (priorSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = priorSkills;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected chart session root");
  rmSync(root, { recursive: true, force: true });
});

it("sends images through actual Pi across tool and queued turns without journaling or later replay", async () => {
  mode = "tool"; agent = createAgent({ dependencies: deps });
  let queued = false;
  agent.subscribe(async event => {
    if (event.type === "before_provider_payload" && !queued) {
      queued = true; await agent!.followUp({ role: "user", content: "Queued text continuation", timestamp: 0 });
    }
  });
  await agent.prompt("Read this chart", { images: [image] });
  expect(requests.length).toBeGreaterThanOrEqual(3);
  for (const request of requests) expect(JSON.stringify(request)).toContain(`data:image/png;base64,${image.data}`);
  const metadata = (await agent.getSessionMetadata())!;
  const journal = readFileSync(metadata.path, "utf8");
  expect(journal).toContain("sha256"); expect(journal).not.toContain(image.data);
  expect(JSON.stringify(agent.state.messages)).not.toContain(image.data);
  expect(JSON.stringify(await agent.getSessionEntries())).not.toContain(image.data);
  mode = "plain"; await agent.prompt("Next independent request"); expect(JSON.stringify(requests.at(-1))).not.toContain("data:image");
  await agent.resumeSession(metadata.id); await agent.prompt("After restore"); expect(JSON.stringify(requests.at(-1))).not.toContain("data:image");
  expect(JSON.stringify(requests.at(-1))).toContain("original image evidence is unavailable");
  agent.reset(); await agent.waitForIdle(); await agent.prompt("Fresh session"); expect(JSON.stringify(requests.at(-1))).not.toContain("whyj-chart-input");
});

it("loads skill instructions and still rejects images for a text-only model", async () => {
  agent = createAgent({ dependencies: deps });
  const skill = (await agent.getSkills())[0]!;
  await agent.skill(skill.name, "Weekly only", { images: [image] });
  expect(JSON.stringify(requests[0])).toContain("data:image/png;base64");
  vision = false; const entries = await agent.getSessionEntries();
  await expect(agent.skill(skill.name, "Weekly only", { images: [image] })).rejects.toThrow();
  await expect(agent.prompt("Text-only model", { images: [image] })).rejects.toThrow("image-capable");
  expect(requests).toHaveLength(1);
  const after = await agent.getSessionEntries();
  expect(after.filter(entry => entry.type === "message")).toEqual(entries.filter(entry => entry.type === "message"));
  expect(after.slice(entries.length).map(entry => entry.type)).toEqual(["model_change"]);
});

it("rejects invalid, queued and concurrent images without disturbing a running request", async () => {
  agent = createAgent({ dependencies: deps }); await agent.waitForIdle();
  await expect(agent.prompt("Invalid", { images: [] })).rejects.toThrow("Supply"); expect(requests).toHaveLength(0);
  await expect(agent.followUp({ role: "user", content: [image], timestamp: 0 })).rejects.toThrow("Queued image");
  await expect(agent.steer({ role: "user", content: [image], timestamp: 0 })).rejects.toThrow("Queued image");
  let observed!: () => void; const reached = new Promise<void>(resolve => { observed = resolve; });
  agent.subscribe(event => { if (event.type === "before_provider_payload") observed(); });
  mode = "hold"; const running = agent.prompt("Hold", { images: [image] }); await reached;
  await expect(agent.prompt("Concurrent", { images: [image] })).rejects.toThrow("finish");
  agent.abort(); await running.catch(() => {}); await agent.waitForIdle();
  mode = "plain"; await agent.prompt("After abort"); expect(JSON.stringify(requests.at(-1))).not.toContain("data:image");
});

it("releases pixels after signal cancellation and authentication failure", async () => {
  agent = createAgent({ dependencies: deps }); await agent.waitForIdle();
  await expect(agent.skill("technical-analyst", undefined, { images: [image], signal: AbortSignal.abort() })).rejects.toThrow();
  failAuth = true; await agent.prompt("Auth fails", { images: [image] }).catch(() => {}); expect(requests).toHaveLength(0);
  failAuth = false; await agent.prompt("No old pixels"); expect(JSON.stringify(requests.at(-1))).not.toContain("data:image");
  const controller = new AbortController(); let reached!: () => void; const payload = new Promise<void>(resolve => { reached = resolve; });
  agent.subscribe(event => { if (event.type === "before_provider_payload") reached(); });
  mode = "hold"; const operation = agent.skill("technical-analyst", undefined, { images: [image], signal: controller.signal }); await payload;
  controller.abort(); await operation.catch(() => {}); await agent.waitForIdle();
  mode = "plain"; await agent.prompt("After signal cancellation"); expect(JSON.stringify(requests.at(-1))).not.toContain("data:image");
});

it("does not replay pixels after a provider rejection or into compaction", async () => {
  agent = createAgent({ dependencies: deps }); mode = "error";
  await agent.prompt("Provider rejects this chart", { images: [image] }).catch(() => {});
  expect(JSON.stringify(requests[0])).toContain("data:image");
  mode = "plain";
  await agent.prompt("Long chart context " + "weekly ".repeat(15000), { images: [image] });
  await agent.prompt("Long continuation " + "analysis ".repeat(15000));
  expect(JSON.stringify(requests.at(-1))).not.toContain("data:image");
  const before = requests.length; await agent.compact("Preserve the fact that original pixels require reattachment");
  expect(requests.length).toBeGreaterThan(before);
  for (const request of requests.slice(before)) expect(JSON.stringify(request)).not.toContain("data:image");
  await agent.prompt("Reattached after compaction", { images: [image] });
  const payload = JSON.stringify(requests.at(-1)); expect(payload.split("data:image/png;base64,")).toHaveLength(2);
  expect(readFileSync((await agent.getSessionMetadata())!.path, "utf8")).not.toContain(image.data);
});
