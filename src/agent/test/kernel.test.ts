import { expect, it } from "bun:test";
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { Type } from "typebox";
import { runAgentLoop } from "../src/kernel/loop.ts";
import { streamSimple } from "../src/kernel/llm.ts";
import { convertToLlm, createDisplayUserMessage } from "../src/session-runtime/harness/messages.ts";
import type { AgentEvent, AgentMessage, AgentTool, StreamFn } from "../src/session-runtime/index.ts";
import { estimateContextTokens } from "../src/session-runtime/harness/compaction/compaction.ts";

const model: Model<"openai-completions"> = {
  id: "fixture", name: "fixture", api: "openai-completions", provider: "openai", baseUrl: "http://unused.invalid/v1",
  reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

it("runs the upstream loop with WhyJ display messages, validated tools, blocking, and ordered results", async () => {
  const schema = Type.Object({ amount: Type.Number() });
  const executed: number[] = [];
  const tool: AgentTool<typeof schema> = {
    name: "measure", label: "Measure", description: "Measure a value", parameters: schema,
    execute: async (_id, args) => {
      executed.push(args.amount);
      return { content: [{ type: "text", text: String(args.amount * 2) }], details: {} };
    },
  };
  const requests: Context[] = [];
  const events: AgentEvent[] = [];
  const result = await runAgentLoop([createDisplayUserMessage("Internal analysis context", "用户输入")], {
    systemPrompt: "fixture", messages: [], tools: [tool],
  }, {
    model, convertToLlm,
    beforeToolCall: async ({ toolCall }) => toolCall.id === "blocked" ? { block: true, reason: "Blocked by fixture" } : undefined,
  }, (event) => { events.push(event); }, undefined, (_model, context) => {
    requests.push({ ...context, messages: structuredClone(context.messages), tools: undefined });
    const first = requests.length === 1;
    const message: AssistantMessage = {
      role: "assistant", api: model.api, model: model.id, provider: model.provider, timestamp: Date.now(),
      stopReason: first ? "toolUse" : "stop",
      content: first ? [
        { type: "toolCall", id: "allowed", name: "measure", arguments: { amount: 3 } },
        { type: "toolCall", id: "blocked", name: "measure", arguments: { amount: 4 } },
        { type: "toolCall", id: "invalid", name: "measure", arguments: { amount: "oops" } },
      ] : [{ type: "text", text: "Done" }],
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: first ? "toolUse" : "stop", message });
    return stream;
  });
  expect(executed).toEqual([3]);
  expect(requests).toHaveLength(2);
  expect(getCurrentSystemPrompt(requests[0]!.messages)).toBe("fixture");
  expect(getCurrentTools(requests[0]!.messages)).toMatchObject([{ name: "measure", parameters: schema }]);
  expect(requests[0]!.messages.find(message => message.role === "user")).toMatchObject({ role: "user", content: [{ type: "text", text: "Internal analysis context" }] });
  expect(JSON.stringify(requests)).not.toContain("displayUser");
  expect(result.find(message => message.role === "displayUser")).toMatchObject({ role: "displayUser", displayText: "用户输入" });
  expect(requests[1]!.messages.filter((message) => message.role === "toolResult").map((message) => [message.toolCallId, message.isError]))
    .toEqual([["allowed", false], ["blocked", true], ["invalid", true]]);
  expect(events.at(-1)?.type).toBe("agent_end");
  expect(result.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
});

it("persists prompt replacements and exact tool changes across turns, reloads, and compacted history", async () => {
  const journal: AgentMessage[] = [];
  const requests: Context[] = [];
  const tools: AgentTool[] = ["initial", "replacement"].map(name => ({
    name, label: name, description: name, parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
  }));
  const stream: StreamFn = (_model, context) => {
    requests.push(structuredClone(context));
    const first = requests.length === 1;
    const message: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
      content: first ? [{ type: "toolCall", id: "switch", name: "initial", arguments: {} }] : [{ type: "text", text: "done" }],
      stopReason: first ? "toolUse" : "stop",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const response = createAssistantMessageEventStream();
    response.push({ type: "done", reason: first ? "toolUse" : "stop", message });
    return response;
  };
  const persist = (event: AgentEvent) => { if (event.type === "message_end") journal.push(structuredClone(event.message)); };
  await runAgentLoop([createDisplayUserMessage("start")], { systemPrompt: "old resources", messages: [], tools: [tools[0]!] }, {
    model, convertToLlm,
    prepareNextTurn: () => ({ context: { systemPrompt: "current resources", messages: structuredClone(journal), tools: [tools[1]!] } }),
  }, persist, undefined, stream);
  expect(requests.map(request => getCurrentSystemPrompt(request.messages))).toEqual(["old resources", "current resources"]);
  expect(requests.map(request => getCurrentTools(request.messages).map(tool => tool.name))).toEqual([["initial"], ["replacement"]]);
  const restored = JSON.parse(JSON.stringify(journal)) as AgentMessage[];
  const resumed = await runAgentLoop([createDisplayUserMessage("resume")], {
    systemPrompt: "current resources", messages: restored, tools: [tools[1]!],
  }, { model, convertToLlm }, persist, undefined, stream);
  expect(resumed.filter(message => message.role === "system")).toHaveLength(0);
  expect(getCurrentSystemPrompt(requests[2]!.messages)).toBe("current resources");
  expect(getCurrentTools(requests[2]!.messages).map(tool => tool.name)).toEqual(["replacement"]);
  // Compaction can remove all earlier declarations: reconstruct from current resources.
  await runAgentLoop([createDisplayUserMessage("after compact")], {
    systemPrompt: "current resources", messages: [{ role: "compactionSummary", summary: "past research", tokensBefore: 5000, timestamp: 1 }], tools: [],
  }, { model, convertToLlm }, persist, undefined, stream);
  expect(getCurrentSystemPrompt(requests[3]!.messages)).toBe("current resources");
  expect(getCurrentTools(requests[3]!.messages)).toEqual([]);
});

it("awaits assistant message persistence before the first tool preflight", async () => {
  let messagePersisted = false, preflightStarted = false, streams = 0;
  let enterGate!: () => void, releaseGate!: () => void;
  const entered = new Promise<void>(resolve => { enterGate = resolve; });
  const release = new Promise<void>(resolve => { releaseGate = resolve; });
  const tool: AgentTool = {
    name: "read_fixed_input", label: "Fixed input", description: "Read a fixed research input", parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: "fixed" }], details: {} }),
  };
  const run = runAgentLoop([createDisplayUserMessage("Research", "研究")],
    { systemPrompt: "fixture", messages: [], tools: [tool] },
    { model, convertToLlm, beforeToolCall: async () => {
      preflightStarted = true;
      expect(messagePersisted).toBe(true);
      return undefined;
    } },
    async event => {
      if (event.type === "message_end" && event.message.role === "assistant" && !messagePersisted) {
        enterGate();
        await release;
        messagePersisted = true;
      }
    }, undefined, () => {
      const first = streams++ === 0;
      const message: AssistantMessage = {
        role: "assistant", api: model.api, model: model.id, provider: model.provider, timestamp: Date.now(),
        stopReason: first ? "toolUse" : "stop",
        content: first ? [{ type: "toolCall", id: "read", name: tool.name, arguments: {} }]
          : [{ type: "text", text: "Research continued" }],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: first ? "toolUse" : "stop", message });
      return stream;
    });
  try {
    await entered;
    await Bun.sleep(20);
    expect(preflightStarted).toBe(false);
  } finally { releaseGate(); }
  const result = await run;
  expect(preflightStarted).toBe(true);
  expect(result.some(message => message.role === "toolResult")).toBe(true);
}, 5_000);

it("returns an error stream for unsupported protocols without throwing from stream setup", async () => {
  const stream = streamSimple({ ...model, api: "unsupported" }, { messages: [] });
  const result = await stream.result();
  expect(result.stopReason).toBe("error");
  expect(result.errorMessage).toContain("Unsupported model protocol");
});

it("counts transcript prompt sections and tool schemas before provider usage is available", () => {
  const base: AgentMessage = { role: "system", content: "", sections: { "whyj.runtime": "x".repeat(4000) }, timestamp: 0 };
  expect(estimateContextTokens([base]).tokens).toBe(1000);
  const withTools: AgentMessage = { ...base, toolsAdded: [{ name: "large_schema", description: "d".repeat(8000), parameters: Type.Object({}) }] };
  expect(estimateContextTokens([withTools]).tokens).toBeGreaterThan(3000);
});

it.each(["finishTurn", "shouldStopAfterTurn"] as const)("honors %s before draining follow-up messages", async hook => {
  let requests = 0, polled = false;
  const events: AgentEvent[] = [];
  await runAgentLoop([createDisplayUserMessage("stop after answer")], { systemPrompt: "fixture", messages: [] }, {
    model, convertToLlm,
    ...(hook === "finishTurn" ? { finishTurn: () => ({ action: "end" as const }) } : { shouldStopAfterTurn: () => true }),
    getFollowUpMessages: async () => { polled = true; return []; },
  }, event => { events.push(event); }, undefined, () => {
    requests++;
    const message: AssistantMessage = {
      role: "assistant", api: model.api, model: model.id, provider: model.provider, timestamp: 0,
      content: [{ type: "text", text: "done" }], stopReason: "stop",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const response = createAssistantMessageEventStream();
    response.push({ type: "done", reason: "stop", message });
    return response;
  });
  expect(requests).toBe(1);
  expect(polled).toBe(false);
  expect(events.slice(-2).map(event => event.type)).toEqual(["turn_end", "agent_end"]);
});
