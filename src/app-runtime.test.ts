import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JsonlSessionRepo } from "./agent/src/pi/index.ts";
import { NodeExecutionEnv } from "./agent/src/pi/node.ts";
import { loadPanelPortfolio, resolveSkillsDir, savePanelPortfolio, saveSettings } from "./storage/index.ts";
import { DEFAULT_SETTINGS } from "./types/config.ts";
import { AppRuntime, createInitialAppState, createRuntimeAgent } from "./app-runtime.ts";
import { shellDisplayName } from "./tools/catalog.ts";
import type { AppState, PanelSection, UIMessage } from "./tui/src/types.ts";

const OHQ = join(process.cwd(), ".ohquant-test-app-runtime");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
  savePanelPortfolio({
    updated: "",
    symbols: [{ code: "510300.SH", name: "沪深300ETF", added: "2026-06-10" }],
    groups: [],
  });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

describe("initial app state", () => {
  it("keeps the raw default model from settings env", () => {
    saveSettings({
      version: 1,
      env: {
        WHYJ_DEFAULT_SONNET_MODEL: "deepseek-v4-pro[1m]",
      },
      model: "sonnet",
      thinkingLevel: "high",
      showPortfolioPanel: true,
      artifactGeneration: { auto: false },
      skillIntegrations: {
        external: false,
      },
      permissions: {},
      preferences: {
        defaultMarket: "A",
        defaultBenchmark: "000300.SH",
        defaultCash: 100_000,
        defaultFast: 20,
        defaultSlow: 60,
        currentPortfolioFile: "holdings.json",
        source: "llmquant-data",
      },
    });

    const state = createInitialAppState("1.0.0");
    expect(state.model).toBe("deepseek-v4-pro[1m]");
  });
});

function harness(
  quoteFetcher: ConstructorParameters<typeof AppRuntime>[1] = async () => [],
  holdingFetcher: ConstructorParameters<typeof AppRuntime>[2] = async () => [],
  agentFactory: ConstructorParameters<typeof AppRuntime>[3] | undefined = undefined,
  autoArtifactRunner: ConstructorParameters<typeof AppRuntime>[4] | undefined = undefined,
  artifactRestoreRunner: ConstructorParameters<typeof AppRuntime>[5] | undefined = undefined,
  marketRefreshTimeoutMs: ConstructorParameters<typeof AppRuntime>[6] | undefined = undefined,
) {
  const messages: UIMessage[][] = [];
  const activities: AppState["activity"][] = [];
  const statuses: AppState["composerStatus"][] = [];
  const panels: Array<{ panel: PanelSection[]; loading: boolean }> = [];
  const queues: string[][] = [];
  const localStates: Array<Pick<AppState, "activePortfolio" | "source" | "showPortfolioPanel">> = [];
  const huds: Array<AppState["hud"]> = [];
  let configOpened = 0;
  let resumeOpened = 0;
  let portfolioOpened = 0;
  const runtime = new AppRuntime(
    {
      onMessages: (m) => messages.push(m),
      onActivity: (a) => activities.push(a),
      onLocalState: (s) => localStates.push(s),
      onComposerStatus: (s) => statuses.push(s),
      onComposerQueue: (q) => queues.push(q),
      onConfigRequest: () => { configOpened++; },
      onResumeRequest: () => { resumeOpened++; },
      onPortfolioRequest: () => { portfolioOpened++; },
      onPanel: (panel, loading = false) => panels.push({ panel, loading }),
      onHud: (hud) => huds.push(hud),
    },
    quoteFetcher,
    holdingFetcher,
    agentFactory,
    autoArtifactRunner,
    artifactRestoreRunner,
    marketRefreshTimeoutMs,
  );
  return { runtime, messages, activities, statuses, panels, queues, localStates, huds, get configOpened() { return configOpened; }, get resumeOpened() { return resumeOpened; }, get portfolioOpened() { return portfolioOpened; } };
}

type RuntimeAgentEvent = { type: string; [key: string]: unknown };

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function makeFakeAgent(promptImpl: (agent: any, input: string) => Promise<void>) {
  const listeners: Array<(event: RuntimeAgentEvent) => void | Promise<void>> = [];
  const agent = {
    state: {
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
      messages: [] as unknown[],
      thinkingText: "",
    },
    subscribe(listener: (event: RuntimeAgentEvent) => void | Promise<void>) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    async emit(event: RuntimeAgentEvent) {
      for (const listener of listeners) await listener(event);
    },
    async prompt(input: string) {
      await promptImpl(agent, input);
    },
    steer() {},
    followUp() {},
    abort() {},
    clearAllQueues() {},
    reset() {},
    waitForIdle: async () => {},
  };
  return agent;
}

describe("AppRuntime.submit", () => {
  it("builds the default runtime agent with installed project skill paths", async () => {
    const skillsDir = join(resolveSkillsDir(), "__runtime-test-repo__", "llmquant-crypto");
    mkdirSync(skillsDir, { recursive: true });
    try {
      writeFileSync(join(skillsDir, "SKILL.md"), `---
name: llmquant-crypto
description: Use for crypto market analysis.
---

# LLMQuant Crypto
`, "utf-8");

      const agent = createRuntimeAgent();
      await agent.waitForIdle();

      const skills = await agent.getSkills();
      expect(skills.some((skill) => skill.name === "llmquant-crypto")).toBe(true);
    } finally {
      rmSync(join(resolveSkillsDir(), "__runtime-test-repo__"), { recursive: true, force: true });
    }
  });

  it("returns exit for exit commands", async () => {
    const h = harness();
    expect(await h.runtime.submit("/exit")).toBe("exit");
    expect(await h.runtime.submit("/quit")).toBe("exit");
  });

  it("handles help and config locally without agent initialization", async () => {
    const h = harness();
    expect(await h.runtime.submit("/help")).toBe("continue");
    expect(h.messages.at(-1)?.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      text: expect.stringContaining("Commands"),
    }));
    expect(h.statuses.at(-1)).toBeNull();
    expect(h.activities.at(-1)).toBe("ready");

    expect(await h.runtime.submit("/config")).toBe("continue");
    expect(h.configOpened).toBe(1);
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("auto-generates an artifact after a completed quant analysis turn", async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      artifactGeneration: { auto: true },
    });
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const autoArtifactRunner = mock(async () => ({ success: true, message: "300308 research" }));
    const h = harness(async () => [], async () => [], () => fakeAgent as never, autoArtifactRunner as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("分析 300308.SZ 的技术面和风险");

    expect(autoArtifactRunner).toHaveBeenCalledTimes(1);
    expect(h.statuses.at(-1)).toEqual({ kind: "info", text: "Artifact ready · 300308 research" });
  });

  it("does not auto-generate artifacts for ordinary chat", async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      artifactGeneration: { auto: true },
    });
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const autoArtifactRunner = mock(async () => ({ success: true, message: "unused" }));
    const h = harness(async () => [], async () => [], () => fakeAgent as never, autoArtifactRunner as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("你好，请介绍一下你自己");

    expect(autoArtifactRunner).not.toHaveBeenCalled();
  });

  it("restores an artifact panel selection without submitting a second-level slash command", async () => {
    const fakeAgent = makeFakeAgent(async () => {});
    const artifactRestoreRunner = mock(async (reportId: string) => ({
      success: true,
      message: `Restored ${reportId}`,
    }));
    const h = harness(
      async () => [],
      async () => [],
      () => fakeAgent as never,
      undefined,
      artifactRestoreRunner as never,
    );

    await h.runtime.bootstrap();
    await h.runtime.restoreArtifact("report-1");

    expect(artifactRestoreRunner).toHaveBeenCalledTimes(1);
    expect(artifactRestoreRunner.mock.calls[0]![0]).toBe("report-1");
    expect(h.statuses.at(-1)).toEqual({ kind: "info", text: "Restored report-1" });
  });
  it("averages TTFT and TPOT across assistant turns", async () => {
    const originalNow = Date.now;
    let now = 1_000;
    let turn = 0;
    Date.now = () => now;
    try {
      const fakeAgent = makeFakeAgent(async (agent) => {
        turn += 1;
        agent.state.isStreaming = true;
        await agent.emit({
          type: "message_start",
          message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: `average turn ${turn}` },
        });
        await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
        if (turn === 1) {
          now = 3_200;
          await agent.emit({
            type: "message_update",
            assistantMessageEvent: { type: "text_start" },
            message: { role: "assistant", content: [{ type: "text", text: "A" }] },
          });
          now = 4_000;
          await agent.emit({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Alpha" }],
              usage: { output: 11 },
            },
          });
        } else {
          now = 5_000;
          await agent.emit({
            type: "message_update",
            assistantMessageEvent: { type: "text_start" },
            message: { role: "assistant", content: [{ type: "text", text: "B" }] },
          });
          now = 5_400;
          await agent.emit({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Beta" }],
              usage: { output: 6 },
            },
          });
        }
        agent.state.isStreaming = false;
        await agent.emit({ type: "agent_end", messages: [] });
      });
      const h = harness(async () => [], async () => [], () => fakeAgent as never);

      await h.runtime.bootstrap();
      await h.runtime.submit("first average turn");
      now = 4_200;
      await h.runtime.submit("second average turn");

      expect(h.huds.at(-1)).toEqual(expect.objectContaining({
        ttftMs: 1500,
        tpotMs: 80,
      }));
    } finally {
      Date.now = originalNow;
    }
  });
  it("bridges agent quant tool errors into polite conversation output", async () => {
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = true;
      await agent.emit({
        type: "message_start",
        message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: "check 000300 risk" },
      });
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({
        type: "tool_execution_start",
        toolCallId: "risk-1",
        toolName: "check_risk",
        args: { symbol: "000300.SH" },
      });
      await agent.emit({
        type: "tool_execution_end",
        toolCallId: "risk-1",
        toolName: "check_risk",
        result: textResult("No cached data for this symbol"),
        isError: true,
      });
      await agent.emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "I could not compute risk from cache." }] },
      });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const h = harness(async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("check 000300 risk");

    const latest = h.messages.at(-1) ?? [];
    expect(latest).toEqual([
      { role: "user", text: "check 000300 risk" },
      { role: "assistant", text: "I could not compute risk from cache." },
      expect.objectContaining({
        role: "tool",
        tool: expect.objectContaining({
          name: "check_risk",
          label: "Quant.Risk · 000300.SH",
          args: "000300.SH",
          status: "error",
          result: "No cached data for this symbol",
        }),
      }),
    ]);
    expect(h.activities).toContain("running tool");
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("updates completed write tool labels to an edit summary", async () => {
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = true;
      await agent.emit({
        type: "message_start",
        message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: "update the catalog" },
      });
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({
        type: "tool_execution_start",
        toolCallId: "bash-write-1",
        toolName: "bash",
        args: { command: "Set-Content src/tools/catalog.ts value" },
      });
      await agent.emit({
        type: "tool_execution_end",
        toolCallId: "bash-write-1",
        toolName: "bash",
        result: textResult("@@ -1,2 +1,2 @@\n-old value\n+new value"),
        isError: false,
      });
      await agent.emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Updated catalog." }] },
      });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const h = harness(async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("update the catalog");

    const latest = h.messages.at(-1) ?? [];
    const tool = latest.find((message) => message.role === "tool");
    expect(tool).toEqual(expect.objectContaining({
      role: "tool",
      tool: expect.objectContaining({
        label: "Edited src/tools/catalog.ts (+1 -1)",
        args: "Set-Content src/tools/catalog.ts value",
        status: "done",
      }),
    }));
  });

  it("adds a specific hint below agent API endpoint errors", async () => {
    const fakeAgent = makeFakeAgent(async () => {
      throw new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:11434");
    });
    const h = harness(async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("hello");

    const latest = h.messages.at(-1) ?? [];
    expect(latest.at(-1)).toEqual({
      role: "error",
      text: expect.stringContaining("Hint: Agent API endpoint is unreachable."),
    });
  });

  it("adds a reconnect-oriented hint below generic connection errors", async () => {
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = true;
      await agent.emit({
        type: "message_start",
        message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: "你是谁" },
      });
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "" }],
          stopReason: "error",
          errorMessage: "Connection error.",
        },
      });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const h = harness(async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("你是谁");

    const latest = h.messages.at(-1) ?? [];
    expect(latest).toEqual([
      { role: "user", text: "你是谁" },
      {
        role: "error",
        text: expect.stringContaining(
          "Hint: Network connection to the agent provider failed. The client may already have retried automatically;",
        ),
      },
    ]);
  });

  it("clears active animation as soon as assistant output ends", async () => {
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = true;
      await agent.emit({
        type: "message_start",
        message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: "finish without agent_end" },
      });
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      agent.state.thinkingText = "Need to answer directly.";
      await agent.emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      });
    });
    const h = harness(async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("finish without agent_end");

    expect(h.messages.at(-1)).toEqual([
      { role: "user", text: "finish without agent_end" },
      expect.objectContaining({ role: "thinking", text: "Need to answer directly.", thinkingLive: false }),
      { role: "assistant", text: "Done." },
    ]);
    expect(h.activities).toContain("thinking");
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("refreshes overview panel after successful command result", async () => {
    const marketSeen: string[][] = [];
    const portfolioSeen: string[][] = [];
    const h = harness(
      async (entries, _meta) => {
        marketSeen.push(entries.map((entry) => entry.code));
        return [{ code: "000001", name: "上证指数", price: 3000, pct: 1 }];
      },
      async (entries, _meta) => {
        portfolioSeen.push(entries.map((entry) => entry.code));
        return [{ code: "510300", name: "沪深300ETF", price: 4.2, pct: -0.5 }];
      },
    );
    await h.runtime.submit("/help");
    expect(marketSeen[0]).toContain("000300.SH");
    expect(portfolioSeen[0]).toEqual(expect.arrayContaining(["510300.SH", "510300"]));
    expect(h.panels[0]).toMatchObject({ loading: true });
    expect(h.panels.at(-1)?.loading).toBe(false);
    const latestPanel = h.panels.at(-1)?.panel ?? [];
    expect(latestPanel[0]).toMatchObject({ kind: "group", title: "Default" });
    expect(latestPanel.some((section) => section.title === "Market")).toBe(true);
    expect(latestPanel.some((section) => section.title === "Source")).toBe(true);
  });

  it("clears the refreshing state and keeps the last good overview when a refresh fails", async () => {
    let failRefresh = false;
    const h = harness(
      async () => {
        if (failRefresh) throw new Error("market source unavailable");
        return [{ code: "000001", name: "上证指数", price: 3000, pct: 1 }];
      },
      async () => [{ code: "510300", name: "沪深300ETF", price: 4.2, pct: -0.5 }],
    );

    await h.runtime.refreshOverviewPanel();
    const readyPanel = h.panels.at(-1)!.panel;
    failRefresh = true;
    await h.runtime.refreshOverviewPanel();

    expect(h.panels.at(-2)).toMatchObject({ loading: true });
    expect(h.panels.at(-1)).toEqual({ panel: readyPanel, loading: false });
  });

  it("recovers from a timed-out pull and ignores its stale late result", async () => {
    let quoteCalls = 0;
    let resolveFirstPull: ((quotes: Array<{ code: string; name: string; price: number; pct: number }>) => void) | undefined;
    const h = harness(
      async () => {
        quoteCalls++;
        if (quoteCalls === 1) {
          return new Promise((resolve) => { resolveFirstPull = resolve; });
        }
        return [{ code: "000001", name: "上证指数", price: 3200, pct: 2 }];
      },
      async () => [{ code: "510300", name: "沪深300ETF", price: 4.3, pct: 0.5 }],
      undefined,
      undefined,
      undefined,
      10,
    );

    await h.runtime.refreshOverviewPanel();
    expect(h.panels.at(-1)).toMatchObject({ loading: false });
    await h.runtime.refreshOverviewPanel();

    const successfulPanel = h.panels.at(-1)!.panel;
    expect(quoteCalls).toBe(2);
    expect(successfulPanel?.some((section) => section.title === "Source")).toBe(true);
    const panelUpdates = h.panels.length;

    resolveFirstPull?.([{ code: "000001", name: "stale", price: 1, pct: -99 }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.panels).toHaveLength(panelUpdates);
    expect(h.panels.at(-1)).toEqual({ panel: successfulPanel, loading: false });
  });

  it("syncs resumed session messages into conversation", async () => {
    const h = harness();
    const agent = {
      state: {
        isStreaming: false,
        messages: [] as Array<{ role: string; content: string }>,
      },
      resumeSession: async (sessionId: string) => {
        agent.state.messages = [
          { role: "user", content: "resume me" },
          { role: "assistant", content: `session ${sessionId} restored` },
        ];
        return { id: sessionId, createdAt: "2026-06-09T00:00:00.000Z", cwd: "C:/tmp", path: `C:/tmp/${sessionId}.jsonl` };
      },
    };
    (h.runtime as unknown as { agent: object }).agent = agent;
    await h.runtime.submit("/resume s0");
    expect(h.messages.at(-1)).toEqual([
      { role: "user", text: "resume me" },
      { role: "assistant", text: "session s0 restored" },
      expect.objectContaining({
        role: "assistant",
        text: expect.stringContaining("Resumed\n"),
      }),
    ]);
    expect(h.messages.at(-1)?.[1]).toEqual(expect.objectContaining({
      role: "assistant",
      text: "session s0 restored",
    }));
    expect(h.statuses.at(-1)).toBeNull();
  });

  it("resumes a real stored JSONL session through the default runtime agent", async () => {
    const sessionsRoot = join(OHQ, "sessions");
    const env = new NodeExecutionEnv({ cwd: process.cwd() });
    const repo = new JsonlSessionRepo({ fs: env, sessionsRoot });

    const older = await repo.create({ cwd: process.cwd() });
    const olderMeta = await older.getMetadata();
    await older.appendMessage({
      role: "user",
      content: [{ type: "text", text: "older session question" }],
      timestamp: Date.now(),
    } as any);
    await older.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "older session answer" }],
      provider: "openai",
      model: "openai/gpt-5.5",
      api: "responses",
      usage: {
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 20,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "end_turn",
      timestamp: Date.now(),
    } as any);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const newer = await repo.create({ cwd: process.cwd() });
    await newer.appendMessage({
      role: "user",
      content: [{ type: "text", text: "newer session question" }],
      timestamp: Date.now(),
    } as any);
    await newer.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "newer session answer" }],
      provider: "openai",
      model: "openai/gpt-5.5",
      api: "responses",
      usage: {
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 20,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "end_turn",
      timestamp: Date.now(),
    } as any);

    const h = harness();
    await h.runtime.bootstrap();
    await h.runtime.submit(`/resume ${olderMeta.id}`);

    expect(h.messages.at(-1)).toEqual([
      { role: "user", text: "older session question" },
      { role: "assistant", text: "older session answer" },
      expect.objectContaining({
        role: "assistant",
        text: expect.stringContaining(`id: ${olderMeta.id}`),
      }),
    ]);
  });

  it("syncs compacted session messages into conversation", async () => {
    const h = harness();
    const agent = {
      state: {
        isStreaming: false,
        messages: [
          { role: "user", content: "old question" },
          { role: "assistant", content: "kept summary" },
        ] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      compact: async () => {
        agent.state.messages = [
          { role: "user", content: "new compacted context" },
          { role: "assistant", content: "summary after compact" },
        ];
        return { summary: "summary after compact", firstKeptEntryId: "e2", tokensBefore: 42 };
      },
      waitForIdle: async () => {},
    };
    (h.runtime as unknown as { agent: object }).agent = agent;
    await h.runtime.submit("/compact keep portfolio facts");
    expect(h.messages.at(-1)).toEqual([
      { role: "user", text: "new compacted context" },
      { role: "assistant", text: "summary after compact" },
      expect.objectContaining({ role: "assistant", text: expect.stringContaining("Compacted") }),
    ]);
  });

  it("waits for active agent turns before compacting", async () => {
    const h = harness();
    const waitForIdle = mock(async () => {});
    const compact = mock(async () => ({ summary: "summary after idle", firstKeptEntryId: "e2", tokensBefore: 42 }));
    const agent = {
      state: {
        isStreaming: true,
        messages: [] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      waitForIdle,
      compact,
    };
    (h.runtime as unknown as { agent: object }).agent = agent;

    await h.runtime.submit("/compact");

    expect(waitForIdle).toHaveBeenCalled();
    expect(compact).toHaveBeenCalledWith(undefined);
    expect(h.activities).toContain("compacting");
    expect(h.messages.at(-1)?.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      text: expect.stringContaining("Compacted"),
    }));
  });

  it("shows compacting status while the slash command is running", async () => {
    const h = harness();
    let release = () => {};
    const compact = mock(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { summary: "summary after compact", firstKeptEntryId: "e2", tokensBefore: 42 };
    });
    const agent = {
      state: {
        isStreaming: false,
        messages: [] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      waitForIdle: mock(async () => {}),
      compact,
    };
    (h.runtime as unknown as { agent: object }).agent = agent;

    const submitPromise = h.runtime.submit("/compact keep quant context");
    await Promise.resolve();

    expect(h.activities).toContain("compacting");
    expect(h.statuses.at(-1)).toEqual({
      kind: "info",
      text: "Compacting the current session context...",
    });

    release();
    await submitPromise;
  });

  it("shows nothing-to-compact as an info status", async () => {
    const h = harness();
    const agent = {
      state: {
        isStreaming: false,
        messages: [] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      waitForIdle: mock(async () => {}),
      compact: mock(async () => {
        throw new Error("Nothing to compact");
      }),
    };
    (h.runtime as unknown as { agent: object }).agent = agent;

    await h.runtime.submit("/compact");

    expect(h.statuses.at(-1)).toEqual({
      kind: "info",
      text: "Nothing to compact. The current session context is already small enough.",
    });
  });

  it("opens resume panel for bare resume command before agent initialization", async () => {
    const h = harness();
    expect(await h.runtime.submit("/resume")).toBe("continue");
    expect(h.resumeOpened).toBe(1);
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("maps missing resumed sessions to a user-facing slash error", async () => {
    const h = harness();
    const agent = {
      state: {
        isStreaming: false,
        messages: [] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      resumeSession: async () => {
        throw new Error("Session not found: missing-session");
      },
    };
    (h.runtime as unknown as { agent: object }).agent = agent;

    await h.runtime.submit("/resume missing-session");

    expect(h.statuses.at(-1)).toEqual({
      kind: "error",
      text: 'Could not find session "missing-session". Run /resume to see saved sessions, then choose one of them.',
    });
  });

  it("opens portfolio panel for bare portfolio command before agent initialization", async () => {
    const h = harness();
    expect(await h.runtime.submit("/portfolio")).toBe("continue");
    expect(h.portfolioOpened).toBe(1);
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("renders portfolio groups even when only group codes are present", async () => {
    savePanelPortfolio({
      updated: "2026-06-10",
      symbols: [],
      groups: [{ id: "group-1", name: "核心组合", symbolCodes: ["510300.SH"] }],
    });
    const holdingSeen: string[][] = [];
    const h = harness(async () => [], async (entries) => {
      holdingSeen.push(entries.map((entry) => entry.code));
      return [];
    });
    await h.runtime.submit("/help");
    const latestPanel = h.panels.at(-1)?.panel ?? [];
    const portfolioSection = latestPanel.find((section) => section.kind === "group" && section.title === "核心组合") as Extract<PanelSection, { kind: "group" }> | undefined;
    expect(portfolioSection).toBeTruthy();
    expect(portfolioSection?.rows.map((row) => row.code)).toEqual(["510300"]);
    expect(holdingSeen.at(-1)).toEqual(expect.arrayContaining(["510300.SH", "510300"]));
  });
  it("selects local portfolio storage and refreshes overview state", async () => {
    mkdirSync(join(OHQ, "portfolio"), { recursive: true });
    await Bun.write(join(OHQ, "portfolio", "holdings_alpha.json"), JSON.stringify({
      name: "Alpha组合",
      updated: "2026-06-01",
      funds: [{ code: "510300", name: "沪深300ETF" }],
    }, null, 2));
    const instrumentsSeen: Array<string | undefined> = [];
    const h = harness(
      async () => [],
      async (entries) => {
        instrumentsSeen.push(...entries.map((entry) => entry.instrument));
        return entries.map((entry) => ({ code: entry.code, name: entry.name, price: 1, pct: 0 }));
      },
    );
    await h.runtime.submit("/portfolio use Alpha组合");
    expect(h.localStates.at(-1)?.activePortfolio).toBe("Alpha组合");
    expect(loadPanelPortfolio().symbols.map((item) => item.code)).toEqual(["510300"]);
    expect(loadPanelPortfolio().symbols[0]?.instrument).toBe("fund");
    expect(instrumentsSeen).toContain("fund");
    const latestPanel = h.panels.at(-1)?.panel ?? [];
    expect(latestPanel.some((section) => section.title === "Alpha组合")).toBe(true);
  });

  it("restores fund identity for an existing bare-code active portfolio", async () => {
    mkdirSync(join(OHQ, "portfolio"), { recursive: true });
    await Bun.write(join(OHQ, "portfolio", "holdings_semicon.json"), JSON.stringify({
      name: "聚焦半导体",
      funds: [{ code: "022364", name: "永赢科技智选发起A" }],
    }));
    saveSettings({
      ...DEFAULT_SETTINGS,
      preferences: { ...DEFAULT_SETTINGS.preferences, currentPortfolioFile: "holdings_semicon.json", source: "akshare" },
    });
    savePanelPortfolio({
      updated: "2026-07-15",
      symbols: [
        { code: "022364", name: "永赢科技智选发起A", added: "2026-07-15" },
        { code: "000001", name: "平安银行", added: "2026-07-15" },
      ],
      groups: [{ id: "default", name: "聚焦半导体", symbolCodes: ["022364"] }],
    });
    const instrumentsSeen = new Map<string, string | undefined>();
    const h = harness(async () => [], async (entries) => {
      for (const entry of entries) instrumentsSeen.set(entry.code, entry.instrument);
      return [];
    });

    await h.runtime.refreshOverviewPanel();

    expect(instrumentsSeen.get("022364")).toBe("fund");
    expect(instrumentsSeen.get("000001")).toBeUndefined();
  });

  it("refreshes overview panel after /clear", async () => {
    const marketSeen: string[][] = [];
    const h = harness(async (entries) => {
      marketSeen.push(entries.map((entry) => entry.code));
      return [];
    });
    await h.runtime.submit("hello");
    const panelsBefore = h.panels.length;
    await h.runtime.submit("/clear");
    expect(h.messages.at(-1)).toEqual([]);
    expect(h.panels.length).toBeGreaterThan(panelsBefore);
    expect(marketSeen.length).toBeGreaterThan(0);
  });
});




