import { describe, expect, it } from "bun:test";
import type { AppState, UIMessage } from "../tui/src/types.ts";
import {
  addUserMessage,
  applyAssistantEnd,
  applyAssistantUpdate,
  finalizeThinking,
  handleAgentEvent,
  startAssistantMessage,
  syncMessagesFromAgentState,
} from "./agent-events.ts";

describe("runtime agent event reducer", () => {
  it("starts assistant turns with a paired live thinking block", () => {
    const result = startAssistantMessage([{ role: "user", text: "hi" }], () => 123);
    expect(result.changed).toBe(true);
    expect(result.messages).toEqual([
      { role: "user", text: "hi" },
      { role: "thinking", text: "", thinkingLive: true, startedAt: 123 },
      { role: "assistant", text: "" },
    ]);
  });

  it("updates assistant text while preserving or inserting thinking content", () => {
    const result = applyAssistantUpdate(
      [{ role: "assistant", text: "" }],
      { content: [{ type: "text", text: "answer" }] },
      "working",
      () => 456,
    );
    expect(result.messages).toEqual([
      { role: "thinking", text: "working", thinkingLive: true, startedAt: 456 },
      { role: "assistant", text: "answer" },
    ]);
  });

  it("finalizes assistant errors with provider hints", () => {
    const result = applyAssistantEnd(
      [
        { role: "thinking", text: "checking", thinkingLive: true, startedAt: 1 },
        { role: "assistant", text: "" },
      ],
      {
        content: [{ type: "text", text: "" }],
        stopReason: "error",
        errorMessage: "Connection error.",
      } as never,
      "checking",
    );
    expect(result.messages).toEqual([
      { role: "thinking", text: "checking", thinkingLive: false, startedAt: 1 },
      {
        role: "error",
        text: expect.stringContaining("Hint: Network connection to the agent provider failed."),
      },
    ]);
  });

  it("suppresses duplicate skill echo without changing visible messages", () => {
    const messages: UIMessage[] = [{
      role: "skill",
      skill: { name: "demo", label: "SKILL.demo", status: "running", startedAt: 1 },
    }];
    expect(addUserMessage(messages, "SKILL.demo")).toEqual({ messages, changed: false });
  });

  it("syncs persisted agent messages and finalizes live thinking", () => {
    expect(syncMessagesFromAgentState([
      { role: "user", content: "q" },
      { role: "assistant", content: [{ type: "text", text: "a" }] },
      { role: "system", content: "skip" },
    ])).toEqual([
      { role: "user", text: "q" },
      { role: "assistant", text: "a" },
    ]);

    expect(finalizeThinking([{ role: "thinking", text: "done", thinkingLive: true, startedAt: 1 }]))
      .toEqual([{ role: "thinking", text: "done", thinkingLive: false, startedAt: 1 }]);
  });

  it("replays persisted tool calls and table results when resuming a session", () => {
    const messages = syncMessagesFromAgentState([
      { role: "user", content: "compare" },
      {
        role: "assistant",
        timestamp: 10,
        content: [
          { type: "thinking", thinking: "hidden" },
          { type: "toolCall", id: "call-a", name: "check_risk", arguments: { symbol: "AAA" } },
          { type: "toolCall", id: "call-b", name: "check_risk", arguments: { symbol: "BBB" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call-b",
        toolName: "check_risk",
        content: [{ type: "text", text: "symbol  risk\n------  ----\nBBB     low" }],
        isError: false,
        timestamp: 11,
      },
      {
        role: "toolResult",
        toolCallId: "call-a",
        toolName: "check_risk",
        content: [{ type: "text", text: "symbol  risk\n------  ----\nAAA     high" }],
        isError: false,
        timestamp: 12,
      },
      { role: "assistant", content: [{ type: "text", text: "Comparison complete." }] },
    ]);

    expect(messages).toHaveLength(4);
    expect(messages[1]).toEqual(expect.objectContaining({
      role: "tool",
      tool: expect.objectContaining({ toolCallId: "call-a", status: "done", result: expect.stringContaining("AAA") }),
    }));
    expect(messages[2]).toEqual(expect.objectContaining({
      role: "tool",
      tool: expect.objectContaining({ toolCallId: "call-b", status: "done", result: expect.stringContaining("BBB") }),
    }));
    expect(messages[3]).toEqual({ role: "assistant", text: "Comparison complete." });
  });

  it("handles tool lifecycle and queue events through the runtime context", () => {
    let messages: UIMessage[] = [];
    const activities: AppState["activity"][] = [];
    const queues: string[][] = [];
    let refreshes = 0;
    const ctx = {
      get messages() { return messages; },
      thinkingText: "",
      setMessages: (next: UIMessage[]) => { messages = next; },
      emitMessages: () => {},
      setActivity: (activity: AppState["activity"]) => { activities.push(activity); },
      setStatus: () => {},
      emitComposerQueue: (queue: string[]) => { queues.push(queue); },
      scheduleMarketRefresh: () => { refreshes++; },
      now: () => 10,
    };

    handleAgentEvent({ type: "tool_execution_start", toolName: "check_risk", args: { symbol: "000300.SH" } }, ctx);
    handleAgentEvent({ type: "tool_execution_update", partialResult: { content: [{ text: "partial" }] } }, ctx);
    handleAgentEvent({ type: "tool_execution_end", result: { content: [{ text: "done" }] }, isError: false }, ctx);
    handleAgentEvent({
      type: "queue_update",
      steer: [],
      followUp: [{ role: "user", content: [{ type: "text", text: "next" }] }],
      nextTurn: [],
    }, ctx);
    handleAgentEvent({ type: "agent_end" }, ctx);

    expect(messages[0]).toEqual(expect.objectContaining({
      role: "tool",
      tool: expect.objectContaining({ status: "done", result: "done" }),
    }));
    expect(activities).toEqual(["running tool", "ready"]);
    expect(queues).toEqual([["next"], []]);
    expect(refreshes).toBe(1);
  });

  it("matches parallel tool results by tool call id", () => {
    let messages: UIMessage[] = [];
    const ctx = {
      get messages() { return messages; },
      thinkingText: "",
      setMessages: (next: UIMessage[]) => { messages = next; },
      emitMessages: () => {},
      setActivity: () => {},
      setStatus: () => {},
      emitComposerQueue: () => {},
      scheduleMarketRefresh: () => {},
      now: () => 10,
    };

    handleAgentEvent({ type: "tool_execution_start", toolCallId: "a", toolName: "check_risk", args: { symbol: "AAA" } }, ctx);
    handleAgentEvent({ type: "tool_execution_start", toolCallId: "b", toolName: "check_risk", args: { symbol: "BBB" } }, ctx);
    handleAgentEvent({ type: "tool_execution_end", toolCallId: "a", result: { content: [{ text: "AAA result" }] }, isError: false }, ctx);
    handleAgentEvent({ type: "tool_execution_end", toolCallId: "b", result: { content: [{ text: "BBB result" }] }, isError: false }, ctx);

    expect(messages.map((message) => message.tool?.result)).toEqual(["AAA result", "BBB result"]);
    expect(messages.map((message) => message.tool?.status)).toEqual(["done", "done"]);
  });
});
