import { describe, expect, it } from "bun:test";
import {
  extractAgentMessageText,
  extractAssistantText,
  extractDisplayText,
  extractTextFromResult,
  extractToolError,
  shouldRenderCommandResultAsMessage,
  toUiMessage,
} from "./messages.ts";

describe("runtime message extraction", () => {
  it("extracts display, text, and thinking content from agent messages", () => {
    expect(extractDisplayText({ role: "displayUser", displayText: "shown", content: "hidden" })).toBe("shown");
    expect(extractAgentMessageText({ role: "assistant", content: [{ type: "thinking", thinking: "plan" }, { type: "text", text: "answer" }] }))
      .toBe("plan\nanswer");
    expect(extractAssistantText({ content: [{ type: "text", text: "a" }, { type: "thinking", thinking: "b" }] }))
      .toBe("a");
  });

  it("converts persisted session messages to UI messages", () => {
    expect(toUiMessage({ role: "user", content: "question" })).toEqual({ role: "user", text: "question" });
    expect(toUiMessage({ role: "assistant", content: [{ type: "text", text: "answer" }] })).toEqual({ role: "assistant", text: "answer" });
    expect(toUiMessage({
      role: "assistant",
      content: [{ type: "thinking", thinking: "private plan" }, { type: "text", text: "visible answer" }],
    })).toEqual({ role: "assistant", text: "visible answer" });
    expect(toUiMessage({ role: "system", content: "skip" })).toBeNull();
  });

  it("extracts tool result text and render shape decisions", () => {
    expect(extractTextFromResult({ content: [{ text: "line 1" }, { text: "line 2" }] })).toBe("line 1\nline 2");
    expect(extractToolError({ content: [{ text: "bad input" }] })).toBe("bad input");
    expect(shouldRenderCommandResultAsMessage("short")).toBe(false);
    expect(shouldRenderCommandResultAsMessage("line 1\nline 2")).toBe(true);
  });
});
