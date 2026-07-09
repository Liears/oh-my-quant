export interface HudContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number | null;
}

export interface HudMetrics {
  contextUsage: HudContextUsage | null;
  turnCount: number;
  /** Session-average TTFT across completed assistant turns with visible output. */
  ttftMs: number | null;
  /** Session-average TPOT across completed assistant turns with token usage. */
  tpotMs: number | null;
}

export interface LatencyTracker {
  turnStartedAt: number | null;
  firstOutputAt: number | null;
}

const FIRST_OUTPUT_EVENT_TYPES = new Set([
  "text_start",
  "text_delta",
  "thinking_start",
  "thinking_delta",
  "toolcall_start",
  "toolcall_delta",
]);

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

export function assistantEventHasVisibleOutput(event: { type?: unknown } | null | undefined): boolean {
  return typeof event?.type === "string" && FIRST_OUTPUT_EVENT_TYPES.has(event.type);
}

export function assistantMessageHasVisibleOutput(message: { content?: unknown } | null | undefined): boolean {
  if (!Array.isArray(message?.content)) return false;
  return message.content.some((part) => {
    if (!part || typeof part !== "object") return false;
    const block = part as { type?: unknown; text?: unknown; thinking?: unknown };
    if (block.type === "toolCall") return true;
    if (block.type === "text") return typeof block.text === "string" && block.text.length > 0;
    if (block.type === "thinking") return typeof block.thinking === "string" && block.thinking.length > 0;
    return false;
  });
}

export function extractAssistantOutputTokens(message: { usage?: { output?: unknown } } | null | undefined): number | null {
  const output = message?.usage?.output;
  return typeof output === "number" && output >= 0 ? output : null;
}

export function computeTpotMs(decodeMs: number | null, outputTokens: number | null): number | null {
  if (decodeMs === null || outputTokens === null || outputTokens <= 0) return null;
  if (outputTokens === 1) return 0;
  return decodeMs / Math.max(1, outputTokens - 1);
}
