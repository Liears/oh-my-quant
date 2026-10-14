import type { HudMetrics } from "../../types/hud.ts";
export type { HudContextUsage, HudMetrics } from "../../types/hud.ts";

export interface LatencyTracker {
  turnStartedAt: number | null;
  firstOutputAt: number | null;
}

export function createHudMetrics(): HudMetrics {
  return {
    contextUsage: null,
    turnCount: 0,
    ttftMs: null,
    tpotMs: null,
  };
}

export function createLatencyTracker(): LatencyTracker {
  return {
    turnStartedAt: null,
    firstOutputAt: null,
  };
}

export function countConversationTurns(messages: Array<{ role?: unknown }>): number {
  return messages.reduce((count, message) => (
    message.role === "user" || message.role === "displayUser" ? count + 1 : count
  ), 0);
}

export function assistantEventHasVisibleOutput(event: { type?: unknown; delta?: unknown; partial?: { content?: unknown } } | null | undefined): boolean {
  if (!event) return false;
  if (["text_delta", "thinking_delta", "toolcall_delta"].includes(String(event.type))) {
    return typeof event.delta === "string" && event.delta.length > 0;
  }
  // Pi's partial is a shared mutable object: a queued *_start may appear to
  // contain later text. Only deltas establish text/thinking timing.
  return event.type === "toolcall_start"
    && assistantMessageHasVisibleOutput(event.partial);
}

export function assistantMessageHasVisibleOutput(message: { content?: unknown } | null | undefined): boolean {
  if (!Array.isArray(message?.content)) return false;
  return message.content.some((part) => {
    if (!part || typeof part !== "object") return false;
    const block = part as { type?: unknown; text?: unknown; thinking?: unknown; name?: unknown };
    if (block.type === "toolCall") return typeof block.name === "string" && block.name.length > 0;
    if (block.type === "text") return typeof block.text === "string" && block.text.length > 0;
    if (block.type === "thinking") return typeof block.thinking === "string" && block.thinking.length > 0;
    return false;
  });
}

export function extractAssistantOutputTokens(message: { usage?: { output?: unknown } } | null | undefined): number | null {
  const output = message?.usage?.output;
  return typeof output === "number" && Number.isSafeInteger(output) && output >= 0 ? output : null;
}

export function computeTpotMs(decodeMs: number | null, outputTokens: number | null): number | null {
  if (decodeMs === null || !Number.isFinite(decodeMs) || decodeMs < 0
    || outputTokens === null || !Number.isSafeInteger(outputTokens) || outputTokens <= 1) return null;
  return decodeMs / (outputTokens - 1);
}
