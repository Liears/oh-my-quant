import { expect, it } from "bun:test";
import { createSessionContext, reduceAgentState } from "../src/session-state.ts";
import { resolveModel } from "../src/model-config.ts";
import type { QuantAgentState } from "../src/session-contracts.ts";

it("clears a previous failure on a new run and settles tool and streaming state", () => {
  const state: QuantAgentState = {
    systemPrompt: "", model: resolveModel("anthropic", "fixture", { WHYJ_QUANT_BASE_URL: "https://unused.invalid/anthropic" }),
    tools: [], messages: [], thinkingLevel: "off", isStreaming: true,
    thinkingText: "Previous thinking", pendingToolCalls: new Set(), errorMessage: "Previous failure",
  };
  const context = createSessionContext();
  reduceAgentState(state, context, [], { type: "agent_start" });
  expect(state.errorMessage).toBeUndefined();
  reduceAgentState(state, context, [], { type: "tool_execution_start", toolCallId: "risk", toolName: "check_risk", args: {} });
  expect(state.pendingToolCalls.has("risk")).toBe(true);
  expect(context.recentToolState).toEqual({ toolName: "check_risk", resultShape: "risk_metrics" });
  reduceAgentState(state, context, [], { type: "agent_end", messages: [] });
  expect(state.isStreaming).toBe(false);
  expect(state.thinkingText).toBe("");
  expect(state.pendingToolCalls.size).toBe(0);
  expect(createSessionContext().recentToolState.toolName).toBeNull();
});
