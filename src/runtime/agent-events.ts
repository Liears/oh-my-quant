import { formatCompletedToolLine, formatToolArgs, formatToolLine } from "./tool-display.ts";
import type { AppState, UIMessage } from "../tui/src/types.ts";
import { formatAgentError, providerStopReasonText } from "./errors.ts";
import {
  extractAgentMessageText,
  extractAssistantText,
  extractDisplayText,
  extractTextFromResult,
  extractToolError,
  toUiMessage,
} from "./messages.ts";

export interface RuntimeAgentEvent {
  type: string;
  [key: string]: any;
}

export interface AgentEventRuntimeContext {
  messages: UIMessage[];
  thinkingText: string;
  setMessages: (messages: UIMessage[]) => void;
  emitMessages: () => void;
  setActivity: (activity: AppState["activity"]) => void;
  setStatus: (status: AppState["composerStatus"]) => void;
  emitComposerQueue: (queue: string[]) => void;
  scheduleMarketRefresh: () => void;
  now?: () => number;
}

export function handleAgentEvent(event: RuntimeAgentEvent, ctx: AgentEventRuntimeContext): void {
  const now = ctx.now ?? Date.now;
  switch (event.type) {
    case "message_start": {
      const message = event.message;
      if (message.role === "user" || message.role === "displayUser") {
        const result = addUserMessage(ctx.messages, extractDisplayText(message));
        ctx.setMessages(result.messages);
        if (result.changed) {
          ctx.emitMessages();
          ctx.setStatus(null);
        }
        break;
      }
      if (message.role === "assistant") {
        const result = startAssistantMessage(ctx.messages, now);
        if (!result.changed) break;
        ctx.setMessages(result.messages);
        ctx.emitMessages();
        ctx.setActivity("thinking");
      }
      break;
    }
    case "message_update": {
      const message = event.message;
      if (message.role !== "assistant") break;
      const result = applyAssistantUpdate(ctx.messages, message, ctx.thinkingText, now);
      if (!result.changed) break;
      ctx.setMessages(result.messages);
      ctx.emitMessages();
      break;
    }
    case "message_end": {
      const message = event.message;
      if (message.role !== "assistant") break;
      const result = applyAssistantEnd(ctx.messages, message, ctx.thinkingText, now);
      ctx.setMessages(result.messages);
      ctx.setActivity("ready");
      ctx.emitMessages();
      break;
    }
    case "tool_execution_start": {
      let messages = finalizeThinking(ctx.messages);
      const args = formatToolArgs(event.args, { truncate: false });
      messages = [
        ...messages,
        {
          role: "tool",
          tool: {
            name: event.toolName,
            label: formatToolLine(event.toolName, args),
            args: args ?? "",
            status: "running",
            startedAt: now(),
          },
        },
      ];
      ctx.setMessages(messages);
      ctx.emitMessages();
      ctx.setActivity("running tool");
      break;
    }
    case "tool_execution_update": {
      const { messages, changed } = updateLatestToolResult(ctx.messages, extractTextFromResult(event.partialResult));
      if (!changed) break;
      ctx.setMessages(messages);
      ctx.emitMessages();
      break;
    }
    case "tool_execution_end": {
      const { messages, changed } = completeLatestTool(ctx.messages, event.result, Boolean(event.isError));
      if (!changed) break;
      ctx.setMessages(messages);
      ctx.emitMessages();
      break;
    }
    case "queue_update": {
      ctx.emitComposerQueue([
        ...event.steer.map((message: unknown) => extractAgentMessageText(message)),
        ...event.followUp.map((message: unknown) => extractAgentMessageText(message)),
        ...event.nextTurn.map((message: unknown) => extractAgentMessageText(message)),
      ]);
      break;
    }
    case "agent_end": {
      ctx.emitComposerQueue([]);
      ctx.scheduleMarketRefresh();
      ctx.setActivity("ready");
      break;
    }
  }
}

export function addUserMessage(messages: UIMessage[], text: string): { messages: UIMessage[]; changed: boolean } {
  const finalized = finalizeThinking(messages);
  if (shouldSuppressSkillEcho(finalized, text)) return { messages: finalized, changed: false };
  return { messages: [...finalized, { role: "user", text }], changed: true };
}

export function pushLocalCommandMessage(messages: UIMessage[], text: string, role: "assistant" | "error"): UIMessage[] {
  return [...finalizeThinking(messages), { role, text }];
}

export function syncMessagesFromAgentState(agentMessages: unknown[]): UIMessage[] {
  return agentMessages
    .map((message) => toUiMessage(message))
    .filter((message): message is UIMessage => message !== null);
}

export function startAssistantMessage(messages: UIMessage[], now: () => number = Date.now): { messages: UIMessage[]; changed: boolean } {
  const last = messages[messages.length - 1];
  const prev = messages[messages.length - 2];
  if (last?.role === "assistant" && prev?.role === "thinking" && prev.thinkingLive) {
    return { messages, changed: false };
  }
  return {
    messages: [
      ...messages,
      { role: "thinking", text: "", thinkingLive: true, startedAt: now() },
      { role: "assistant", text: "" },
    ],
    changed: true,
  };
}

export function applyAssistantUpdate(
  messages: UIMessage[],
  message: { content: unknown[] },
  thinkingText: string,
  now: () => number = Date.now,
): { messages: UIMessage[]; changed: boolean } {
  let next = [...messages];
  let assistantIndex = findLatestMessageIndex(next, "assistant");
  if (assistantIndex < 0) return { messages, changed: false };
  if (thinkingText.trim()) next = upsertThinkingMessage(next, thinkingText, now);
  assistantIndex = findLatestMessageIndex(next, "assistant");
  next[assistantIndex] = { ...next[assistantIndex]!, text: extractAssistantText(message) };
  return { messages: next, changed: true };
}

export function applyAssistantEnd(
  messages: UIMessage[],
  message: { content: unknown[] },
  thinkingText: string,
  now: () => number = Date.now,
): { messages: UIMessage[] } {
  const text = extractAssistantText(message);
  const raw = message as Record<string, unknown>;
  const stopReason = raw.stopReason;
  const errorMessage = typeof raw.errorMessage === "string" ? raw.errorMessage : undefined;
  const isError = stopReason === "error" || stopReason === "aborted";
  let next = [...messages];
  if (thinkingText.trim()) next = upsertThinkingMessage(next, thinkingText, now);
  next = finalizeThinking(next);
  next = removeTrailingThinkingAfterAssistant(next);
  const assistantIndex = findLatestMessageIndex(next, "assistant");
  const errText = errorMessage || text || providerStopReasonText(stopReason);
  if (assistantIndex >= 0) {
    next[assistantIndex] = {
      ...next[assistantIndex]!,
      role: isError ? "error" : "assistant",
      text: isError ? formatAgentError("Agent error", errText) : text,
    };
  } else if (isError) {
    next.push({ role: "error", text: formatAgentError("Agent error", errText) });
  }
  return { messages: next };
}

export function upsertThinkingMessage(messages: UIMessage[], text: string, now: () => number = Date.now): UIMessage[] {
  const next = [...messages];
  const pairedIndex = findPairedThinkingIndex(next);
  if (pairedIndex >= 0) {
    next[pairedIndex] = { ...next[pairedIndex]!, text };
    return next;
  }
  const assistantIndex = findLatestMessageIndex(next, "assistant");
  if (assistantIndex >= 0) {
    next.splice(assistantIndex, 0, { role: "thinking", text, thinkingLive: true, startedAt: now() });
    return next;
  }
  next.push({ role: "thinking", text, thinkingLive: true, startedAt: now() });
  return next;
}

export function finalizeThinking(messages: UIMessage[]): UIMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    const msg = next[i]!;
    if (msg.role !== "thinking" || !msg.thinkingLive) continue;
    if (!msg.text?.trim()) next.splice(i, 1);
    else next[i] = { ...msg, thinkingLive: false };
    return next;
  }
  return messages;
}

export function finalizeSkillMessage(messages: UIMessage[], isError: boolean): { messages: UIMessage[]; changed: boolean } {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    const msg = next[i]!;
    if (msg.role !== "skill" || msg.skill?.status !== "running") continue;
    next[i] = {
      ...msg,
      skill: msg.skill ? { ...msg.skill, status: isError ? "error" : "done" } : msg.skill,
    };
    return { messages: next, changed: true };
  }
  return { messages, changed: false };
}

export function removeTrailingThinkingAfterAssistant(messages: UIMessage[]): UIMessage[] {
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      lastAssistant = i;
      break;
    }
  }
  if (lastAssistant < 0) return messages;
  return messages.filter((msg, idx) => idx <= lastAssistant || msg.role !== "thinking");
}

function updateLatestToolResult(messages: UIMessage[], result: string): { messages: UIMessage[]; changed: boolean } {
  const last = messages[messages.length - 1];
  if (last?.role !== "tool" || !last.tool) return { messages, changed: false };
  return {
    messages: [
      ...messages.slice(0, -1),
      { ...last, tool: { ...last.tool, result } },
    ],
    changed: true,
  };
}

function completeLatestTool(messages: UIMessage[], result: unknown, isError: boolean): { messages: UIMessage[]; changed: boolean } {
  const last = messages[messages.length - 1];
  if (last?.role !== "tool" || !last.tool) return { messages, changed: false };
  const resultText = isError ? extractToolError(result) : extractTextFromResult(result);
  const tool = {
    ...last.tool,
    status: isError ? "error" as const : "done" as const,
    result: resultText,
    label: formatCompletedToolLine(last.tool.name, last.tool.args, resultText, isError),
  };
  return {
    messages: [...messages.slice(0, -1), { ...last, tool }],
    changed: true,
  };
}

function shouldSuppressSkillEcho(messages: UIMessage[], text: string): boolean {
  const trimmed = text.trim();
  if (!/^SKILL\.[a-z0-9-]+$/i.test(trimmed)) return false;
  const last = messages[messages.length - 1];
  return last?.role === "skill" && last.skill?.label === trimmed;
}

function findLatestMessageIndex(messages: UIMessage[], role: UIMessage["role"]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === role) return i;
  }
  return -1;
}

function findPairedThinkingIndex(messages: UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== "assistant") continue;
    return messages[i - 1]?.role === "thinking" ? i - 1 : -1;
  }
  return -1;
}
