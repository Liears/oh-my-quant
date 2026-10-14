import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { AppRuntime } from "../../app-runtime.ts";
import { resolveConfiguredModel } from "../../agent/src/model-config.ts";
import type { QuantAgentEvent, QuantAgentSession } from "../../agent/src/session-contracts.ts";
import type { HudMetrics } from "../../runtime/workspace/hud.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { loadSettings, saveSettings } from "../../storage/index.ts";

let root: string;
let previousDir: string | undefined;
let runtime: AppRuntime;
let now: number;
let originalNow: typeof Date.now;
let huds: HudMetrics[];
let sessionId: string;
let mode: "ok" | "failed" | "final-only";
let state: QuantAgentSession["state"];
let emit: (event: unknown) => Promise<void>;

beforeEach(async () => {
  previousDir = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-hud-lifecycle-"));
  process.env.OHQUANT_DIR = root;
  const settings = { ...structuredClone(DEFAULT_SETTINGS), provider: "custom", model: "hud-fixture", thinkingLevel: "off",
    providers: { custom: { baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions" as const } } };
  saveSettings(settings);
  originalNow = Date.now;
  now = 1000;
  Date.now = () => now;
  huds = [];
  sessionId = "first";
  mode = "ok";
  const listeners = new Set<(event: QuantAgentEvent) => void | Promise<void>>();
  state = { systemPrompt: "", model: resolveConfiguredModel(settings), thinkingLevel: "off", tools: [], messages: [],
    isStreaming: false, thinkingText: "", pendingToolCalls: new Set() };
  emit = async event => { for (const listener of listeners) await listener(event as QuantAgentEvent); };
  const agent = {
    state, subscribe(listener: (event: QuantAgentEvent) => void | Promise<void>) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async prompt() {
      state.isStreaming = true;
      await emit({ type: "before_provider_request", model: state.model, sessionId, streamOptions: {} });
      const message = { role: "assistant", content: [{ type: "text", text: "" }], usage: { output: 5 }, stopReason: "stop" };
      now += 10;
      await emit({ type: "message_update", message, assistantMessageEvent: { type: "text_start" } });
      now += 90;
      message.content[0]!.text = "Value";
      if (mode !== "final-only") await emit({ type: "message_update", message, assistantMessageEvent: { type: "text_delta", delta: "Value" } });
      now += 200;
      if (mode === "failed") message.stopReason = "error";
      await emit({ type: "message_end", message });
      state.isStreaming = false;
      await emit({ type: "agent_end", messages: [] });
    },
    async resumeSession(id: string) {
      if (id === "missing") throw new Error("Session not found: missing");
      sessionId = id;
      state.messages = [];
      return { id, createdAt: new Date().toISOString(), cwd: root, path: `${root}/${id}.jsonl` };
    },
    getContextUsage: () => ({ tokens: 100, contextWindow: 1000, percent: 10 }),
    getSkills: async () => [],
    async skill() { await this.prompt(); },
    waitForIdle: async () => {}, abort() {}, clearAllQueues() {}, reset() { sessionId = "reset"; state.messages = []; }, updateContext() {},
  };
  runtime = new AppRuntime({ onMessages() {}, onActivity() {}, onHud(hud) { if (hud) huds.push(hud); } },
    async () => [], async () => [], () => agent as unknown as QuantAgentSession, undefined, undefined, 100, 0);
  await runtime.bootstrap();
});

afterEach(() => {
  runtime?.dispose();
  Date.now = originalNow;
  if (previousDir === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previousDir;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected HUD fixture path");
  rmSync(root, { recursive: true, force: true });
});

it("ignores empty block starts and failed/final-only responses in HUD averages", async () => {
  await runtime.submit("fixed sample");
  expect(huds.at(-1)).toMatchObject({ ttftMs: 100, tpotMs: 50 });
  mode = "failed";
  await runtime.submit("failed sample");
  expect(huds.at(-1)).toMatchObject({ ttftMs: 100, tpotMs: 50 });
  await runtime.submit("/clear");
  expect(huds.at(-1)).toMatchObject({ ttftMs: null, tpotMs: null });
  mode = "final-only";
  await runtime.submit("unobserved stream");
  expect(huds.at(-1)).toMatchObject({ ttftMs: null, tpotMs: null });
});

it("resets successful session restores and keeps current metrics on failed restore", async () => {
  await runtime.submit("first");
  await runtime.submit("/resume missing");
  expect(huds.at(-1)).toMatchObject({ ttftMs: 100, tpotMs: 50 });
  await runtime.submit("/resume second");
  expect(huds.at(-1)).toMatchObject({ ttftMs: null, tpotMs: null });
  await runtime.submit("second");
  expect(huds.at(-1)).toMatchObject({ ttftMs: 100, tpotMs: 50 });
});

it("isolates model changes and preserves metrics for unrelated appearance changes", async () => {
  await runtime.submit("first");
  const appearance = loadSettings();
  appearance.preferences.marketColorScheme = "green-up";
  saveSettings(appearance);
  runtime.refreshConfiguration();
  expect(huds.at(-1)).toMatchObject({ ttftMs: 100, tpotMs: 50 });
  const connection = loadSettings();
  connection.model = "new-model";
  saveSettings(connection);
  runtime.refreshConfiguration();
  expect(huds.at(-1)).toMatchObject({ ttftMs: null, tpotMs: null, contextUsage: null });
  state.model = resolveConfiguredModel(connection);
  mode = "final-only";
  await runtime.submit("new model");
  expect(huds.at(-1)).toMatchObject({ ttftMs: null, tpotMs: null });
});

it("applies connection changes saved during a run before the next prompt or explicit skill", async () => {
  await runtime.submit("first");
  state.isStreaming = true;
  const connection = loadSettings(); connection.providers!.custom!.apiKey = "next-fixture-key"; saveSettings(connection);
  runtime.refreshConfiguration();
  expect(huds.at(-1)).toMatchObject({ ttftMs: 100, tpotMs: 50 });
  state.isStreaming = false; mode = "final-only";
  await runtime.submit("next connection");
  expect(huds.at(-1)).toMatchObject({ ttftMs: null, tpotMs: null });
  mode = "ok"; await runtime.submit("measure again");
  expect(huds.at(-1)).toMatchObject({ ttftMs: 100, tpotMs: 50 });
  const next = loadSettings(); next.providers!.custom!.apiKey = "skill-fixture-key"; saveSettings(next);
  mode = "final-only";
  await runtime.submit("/skill run fixture");
  expect(huds.at(-1)).toMatchObject({ ttftMs: null, tpotMs: null });
});
