import { describe, expect, it } from "bun:test";

import {
  assistantEventHasVisibleOutput,
  assistantMessageHasVisibleOutput,
  computeTpotMs,
  countConversationTurns,
  extractAssistantOutputTokens,
} from "../workspace/hud.ts";

describe("hud metrics", () => {
  it("counts user and displayUser messages as turns", () => {
    expect(countConversationTurns([
      { role: "user" },
      { role: "assistant" },
      { role: "displayUser" },
      { role: "toolResult" },
    ])).toBe(2);
  });

  it("detects the first visible assistant output event", () => {
    expect(assistantEventHasVisibleOutput({ type: "text_delta", delta: "A" })).toBe(true);
    expect(assistantEventHasVisibleOutput({ type: "text_delta", delta: "" })).toBe(false);
    expect(assistantEventHasVisibleOutput({ type: "thinking_start" })).toBe(false);
    expect(assistantEventHasVisibleOutput({ type: "text_start", partial: { content: [{ type: "text", text: "later output" }] } })).toBe(false);
    expect(assistantEventHasVisibleOutput({ type: "toolcall_start", partial: { content: [{ type: "toolCall", name: "" }] } })).toBe(false);
    expect(assistantEventHasVisibleOutput({ type: "toolcall_start", partial: { content: [{ type: "toolCall", name: "compute_factor" }] } })).toBe(true);
    expect(assistantEventHasVisibleOutput({ type: "message_end" })).toBe(false);
  });

  it("detects visible assistant content from the finalized message", () => {
    expect(assistantMessageHasVisibleOutput({
      content: [{ type: "thinking", thinking: "planning" }],
    })).toBe(true);
    expect(assistantMessageHasVisibleOutput({
      content: [{ type: "text", text: "" }],
    })).toBe(false);
  });

  it("extracts output tokens and computes TPOT after TTFT", () => {
    expect(extractAssistantOutputTokens({ usage: { output: 9 } })).toBe(9);
    expect(computeTpotMs(800, 9)).toBe(100);
    expect(computeTpotMs(800, 1)).toBeNull();
    expect(computeTpotMs(-1, 9)).toBeNull();
    expect(computeTpotMs(Infinity, 9)).toBeNull();
    expect(computeTpotMs(800, NaN)).toBeNull();
    expect(extractAssistantOutputTokens({ usage: { output: Infinity } })).toBeNull();
    expect(computeTpotMs(null, 9)).toBeNull();
  });
});

