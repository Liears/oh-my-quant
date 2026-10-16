import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppRuntime } from "../../src/app-runtime.ts";
import { saveSettings } from "../../src/storage/index.ts";
import { DEFAULT_SETTINGS } from "../../src/types/config.ts";
import type { ComposerStatus, UIMessage } from "../../src/types/ui.ts";

it("interrupts the active request without exiting or reporting it, then accepts explicit continuation", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-interruption-"));
  const previous = process.env.OHQUANT_DIR;
  process.env.OHQUANT_DIR = root;
  saveSettings({ ...DEFAULT_SETTINGS, artifactGeneration: { auto: true } });
  type Event = { type: string; [key: string]: unknown };
  const listeners: Array<(event: Event) => void | Promise<void>> = [];
  const emit = async (event: Event) => { for (const listener of listeners) await listener(event); };
  let ready!: () => void, halt!: (error: Error) => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const halted = new Promise<void>((_, reject) => { halt = reject; });
  const requests: string[] = [];
  let active: Promise<void> | undefined;
  const agent = {
    state: { isStreaming: false, pendingToolCalls: new Set<string>(), messages: [] as unknown[], thinkingText: "", thinkingLevel: "max" },
    subscribe(listener: (event: Event) => void | Promise<void>) { listeners.push(listener); return () => {}; },
    async prompt(input: string) {
      requests.push(input);
      active = (async () => {
        agent.state.isStreaming = true;
        await emit({ type: "message_start", message: { role: "user", content: [{ type: "text", text: input }] } });
        try {
          if (requests.length === 1) { ready(); await halted; }
          else await emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Research continued from saved evidence." }], usage: { output: 8 } } });
        } finally { agent.state.isStreaming = false; await emit({ type: "agent_end", messages: [] }); }
      })();
      try { await active; } finally { active = undefined; }
    },
    abort() { halt(new Error("Request aborted")); },
    waitForIdle: async () => { await active?.catch(() => {}); },
  };
  let messages: UIMessage[] = [];
  let status: ComposerStatus | null = null;
  let reports = 0;
  let forwardedSignal: AbortSignal | undefined;
  const originalPrompt = agent.prompt.bind(agent);
  agent.prompt = async (input: string, options?: { signal?: AbortSignal }) => {
    forwardedSignal = options?.signal;
    await originalPrompt(input);
  };
  const runtime = new AppRuntime({ onMessages: value => { messages = value; }, onActivity: () => {}, onComposerStatus: value => { status = value; } },
    async () => [], async () => [], () => agent as never, async () => { reports++; return { success: true, message: "continued research" }; }, undefined, undefined, 0);
  try {
    await runtime.bootstrap();
    const request = runtime.submit("分析 AAPL 的动量和风险");
    await started;
    expect(await runtime.interruptResearch()).toBe(true);
    expect(forwardedSignal?.aborted).toBe(true);
    await request;
    expect(reports).toBe(0);
    expect(messages.some(message => message.text?.includes("分析 AAPL"))).toBe(true);
    expect(messages.some(message => message.role === "error")).toBe(false);
    expect((status as ComposerStatus | null)?.text).toContain("继续");
    await runtime.submit("继续分析 AAPL 的动量和风险，使用已保存的核验证据");
    expect(requests).toEqual(["分析 AAPL 的动量和风险", "继续分析 AAPL 的动量和风险，使用已保存的核验证据"]);
    expect(reports).toBe(1);
    expect(agent.state.thinkingLevel).toBe("max");
  } finally {
    runtime.dispose();
    if (previous === undefined) delete process.env.OHQUANT_DIR;
    else process.env.OHQUANT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

it("cancels a prompt still preparing before the model starts", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-preparing-interruption-"));
  const previous = process.env.OHQUANT_DIR;
  process.env.OHQUANT_DIR = root;
  let release!: () => void, prepared!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const preparing = new Promise<void>(resolve => { prepared = resolve; });
  let modelStarts = 0;
  let activity = "ready";
  const agent = { state: { isStreaming: false, pendingToolCalls: new Set<string>(), messages: [], thinkingText: "" },
    subscribe: () => () => {}, abort: () => {}, waitForIdle: async () => {},
    prompt: async (_input: string, options?: { signal?: AbortSignal }) => {
      prepared(); await gate; options?.signal?.throwIfAborted(); modelStarts++;
    } };
  const runtime = new AppRuntime({ onMessages: () => {}, onActivity: value => { activity = value; } }, async () => [], async () => [], () => agent as never,
    undefined, undefined, undefined, 0);
  try {
    await runtime.bootstrap();
    const request = runtime.submit("分析 AAPL 的风险");
    await preparing;
    expect(activity).toBe("thinking");
    expect(await runtime.interruptResearch()).toBe(true);
    release(); await request;
    expect(modelStarts).toBe(0);
  } finally {
    release(); runtime.dispose();
    if (previous === undefined) delete process.env.OHQUANT_DIR;
    else process.env.OHQUANT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
