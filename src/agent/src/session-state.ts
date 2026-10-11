import type { AgentEvent, AgentHarnessEvent, AgentTool, SessionContext } from './session-runtime/index.ts';
import type { QuantAgentState, QuantAgentEvent, QuantModelState } from './session-contracts.ts';
import type { SessionCtx } from './context.ts';
import { inferResultShape } from './tool-result-shape.ts';

export function createSessionContext(): SessionCtx {
  return {
    lastSymbol: null,
    lastMarket: null,
    lastStartDate: null,
    lastEndDate: null,
    recentToolState: { toolName: null, resultShape: null },
  };
}

export function reduceAgentState(state: QuantAgentState, sessionCtx: SessionCtx, tools: AgentTool[], event: AgentHarnessEvent): void {
  switch (event.type) {
    case "agent_start":
      state.errorMessage = undefined;
      break;
    case "message_start":
      state.isStreaming = true;
      state.streamingMessage = event.message;
      if (event.message.role === "assistant") {
        state.thinkingText = "";
      }
      break;
    case "message_update":
      state.streamingMessage = event.message;
      if (event.message.role === "assistant") {
        state.thinkingText = extractThinkingFromMessage(event.message);
      }
      break;
    case "message_end":
      state.streamingMessage = undefined;
      state.messages = [...state.messages, event.message];
      if (event.message.role === "assistant" && event.message.errorMessage) {
        state.errorMessage = event.message.errorMessage;
      }
      break;
    case "tool_execution_start": {
      const pending = new Set(state.pendingToolCalls);
      pending.add(event.toolCallId);
      state.pendingToolCalls = pending;
      sessionCtx.recentToolState.toolName = event.toolName;
      sessionCtx.recentToolState.resultShape = inferResultShape(event.toolName);
      break;
    }
    case "tool_execution_end": {
      const pending = new Set(state.pendingToolCalls);
      pending.delete(event.toolCallId);
      state.pendingToolCalls = pending;
      sessionCtx.recentToolState.toolName = event.toolName;
      sessionCtx.recentToolState.resultShape = inferResultShape(event.toolName, event.result);
      break;
    }
    case "agent_end":
      state.isStreaming = false;
      state.streamingMessage = undefined;
      state.thinkingText = "";
      state.pendingToolCalls = new Set<string>();
      break;
    case "model_update":
      state.model = event.model;
      break;
    case "thinking_level_update":
      state.thinkingLevel = event.level;
      break;
    case "tools_update":
      state.tools = tools.filter((tool) => event.toolNames.includes(tool.name));
      break;
  }
}

function isCoreAgentEvent(event: AgentHarnessEvent): event is AgentEvent {
  return event.type === "message_start"
    || event.type === "message_update"
    || event.type === "message_end"
    || event.type === "tool_execution_start"
    || event.type === "tool_execution_update"
    || event.type === "tool_execution_end"
    || event.type === "turn_end"
    || event.type === "agent_end";
}

export function isForwardedAgentEvent(event: AgentHarnessEvent): event is QuantAgentEvent {
  return isCoreAgentEvent(event)
    || event.type === "queue_update"
    || event.type === "before_provider_request"
    || event.type === "before_provider_payload"
    || event.type === "after_provider_response";
}

export function applySessionContextState(
  state: QuantAgentState,
  context: SessionContext,
  connection: QuantModelState,
): void {
  state.messages = [...context.messages];
  state.model = connection.model;
  state.thinkingLevel = connection.thinkingLevel;
}

function extractThinkingFromMessage(m: { role?: string; content?: unknown[] }): string {
  if (!m.content || !Array.isArray(m.content)) return "";
  return (m.content as Array<{ type?: string; thinking?: string }>)
    .filter((c) => c.type === "thinking" && c.thinking)
    .map((c) => c.thinking!)
    .join("\n");
}
