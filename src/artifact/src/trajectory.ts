/** Lossless session JSONL -> auditable trajectory conversion. */
import type {
  RawEntry,
  ContentBlock,
  TrajectoryDocument,
  TrajectoryEvent,
  TrajectorySourceRef,
  TrajectorySummary,
} from "./types.ts";
import { redactEventToolArgs } from "./redact.ts";
import { extractText } from "./message-text.ts";

const SKILL_NAME_RE = /<skill\s+name\s*=\s*["']([^"']+)["']/i;

type ToolKind = "tool" | "bash" | "skill";
interface ToolCallMeta { name: string; kind: ToolKind }

interface CaptureStats {
  sourceEntryCount: number;
  sourceMessageCount: number;
  sourceContentBlockCount: number;
  capturedContentBlockCount: number;
}

export function buildTrajectoryFromSession(
  entries: RawEntry[],
  sessionId: string,
  runId: string,
  mode: "compact" | "audit" | "debug" | "raw" = "compact",
): TrajectoryDocument {
  const events: TrajectoryEvent[] = [];
  const toolCalls = new Map<string, ToolCallMeta>();
  const capture: CaptureStats = {
    sourceEntryCount: entries.length,
    sourceMessageCount: 0,
    sourceContentBlockCount: 0,
    capturedContentBlockCount: 0,
  };
  let stepIdx = 0;
  let turnIndex = 0;

  const push = (event: Omit<TrajectoryEvent, "id" | "runId" | "sessionId">): void => {
    stepIdx++;
    events.push({ id: `evt_${stepIdx}`, runId, sessionId, ...event });
  };

  for (const entry of entries) {
    const ts = typeof entry.timestamp === "string" ? entry.timestamp : "";

    if (entry.type === "compaction") {
      push({
        timestamp: ts,
        turnIndex,
        type: "context_compaction",
        title: "Context compaction",
        summary: typeof entry.summary === "string" ? entry.summary : "Compaction boundary",
        raw: entry.summary ?? entry,
        source: sourceRef(entry),
        visibility: "debug",
      });
      continue;
    }

    if (entry.type !== "message") {
      push({
        timestamp: ts,
        turnIndex,
        type: "raw_content",
        title: `Source entry: ${String(entry.type || "unknown")}`,
        raw: entry,
        source: sourceRef(entry),
        visibility: "debug",
      });
      continue;
    }

    capture.sourceMessageCount++;
    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg || typeof msg.role !== "string") {
      push({
        timestamp: ts,
        turnIndex,
        type: "raw_content",
        title: "Malformed message",
        raw: entry.message,
        source: sourceRef(entry),
        visibility: "debug",
      });
      continue;
    }

    const role = String(msg.role);
    const blocks = contentBlocks(msg.content);
    capture.sourceContentBlockCount += blocks.length;

    if (role === "user" || role === "displayUser") {
      turnIndex++;
      const modelInput = contentTextOrRaw(msg.content);
      const visibleInput = typeof msg.displayText === "string" && msg.displayText.length > 0
        ? msg.displayText
        : modelInput;
      capture.capturedContentBlockCount += blocks.length;

      push({
        timestamp: ts,
        turnIndex,
        type: "user_request",
        title: "用户输入",
        summary: visibleInput || "(empty input)",
        raw: visibleInput,
        source: sourceRef(entry, msg),
        visibility: "public",
      });

      if (modelInput && visibleInput !== modelInput) {
        push({
          timestamp: ts,
          turnIndex,
          type: "model_input",
          title: "模型实际输入",
          summary: modelInput,
          raw: modelInput,
          source: sourceRef(entry, msg, 0, blocks[0]?.type),
          visibility: "debug",
        });
      }
      continue;
    }

    if (role === "assistant") {
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const block = blocks[blockIndex]!;
        capture.capturedContentBlockCount++;
        const source = sourceRef(entry, msg, blockIndex, block.type);

        if (block.type === "thinking") {
          push({
            timestamp: ts,
            turnIndex,
            type: "assistant_thinking",
            title: "Assistant thinking",
            summary: block.thinking || "(empty thinking block)",
            raw: block.thinking ?? block,
            source,
            visibility: "debug",
          });
          continue;
        }

        if (block.type === "text") {
          const text = block.text ?? "";
          const isFinal = msg.stopReason === "stop" && blockIndex === lastTextBlockIndex(blocks);
          push({
            timestamp: ts,
            turnIndex,
            type: isFinal ? "final_answer" : "observation",
            title: isFinal ? "最终输出" : "分析输出",
            summary: text || "(empty text block)",
            raw: text,
            source,
            visibility: "public",
          });
          continue;
        }

        if (isToolCallBlock(block)) {
          const record = block as ContentBlock & Record<string, unknown>;
          const rawName = String(record.name || record.toolName || "unknown");
          const args = record.arguments ?? record.input ?? record.args;
          const callId = firstString(record.id, record.toolCallId, record.tool_call_id) || `call_${stepIdx + 1}`;
          const argsPreview = formatToolArgsPreview(args);
          const kind = toolKind(rawName);
          const skillName = kind === "skill" ? extractSkillName(args, rawName) : "";
          const displayName = skillName || rawName;
          toolCalls.set(callId, { name: displayName, kind });
          push({
            timestamp: ts,
            turnIndex,
            type: "tool_call",
            title: kind === "skill" ? `Skill: ${displayName}` : displayName,
            tool: {
              callId,
              name: displayName,
              kind,
              args,
              argsPreview: skillName || argsPreview,
            },
            raw: block,
            source,
            visibility: "debug",
          });
          continue;
        }

        push({
          timestamp: ts,
          turnIndex,
          type: "raw_content",
          title: `Assistant block: ${String(block.type || "unknown")}`,
          raw: block,
          source,
          visibility: "debug",
        });
      }
      continue;
    }

    if (isToolResultRole(role)) {
      capture.capturedContentBlockCount += blocks.length;
      const callId = firstString(msg.toolCallId, msg.tool_call_id, msg.callId) || `call_${stepIdx + 1}`;
      const callMeta = toolCalls.get(callId);
      const persistedName = firstString(msg.toolName, msg.name) || "";
      const persistedKind = toolKind(persistedName);
      const kind = callMeta?.kind ?? persistedKind;
      const toolName = callMeta?.name || persistedName || "unknown";
      const text = formatToolResultContent(msg.content);
      const hasRawResult = Array.isArray(msg.content)
        ? msg.content.length > 0
        : msg.content !== undefined && msg.content !== null && msg.content !== "";
      const result = text || (hasRawResult ? msg.content : "(empty tool result)");
      const isError = msg.isError === true || msg.status === "error";
      push({
        timestamp: ts,
        turnIndex,
        type: "tool_result",
        title: toolName,
        tool: {
          callId,
          name: toolName,
          kind,
          args: {},
          resultPreview: result,
          resultDetails: msg.details,
          error: isError
            ? { name: "ToolError", message: text || `${toolName} failed` }
            : undefined,
        },
        raw: { content: msg.content, details: msg.details },
        source: sourceRef(entry, msg, 0, blocks[0]?.type),
        status: isError ? "error" : "success",
        visibility: "debug",
      });
      continue;
    }

    capture.capturedContentBlockCount += blocks.length;
    push({
      timestamp: ts,
      turnIndex,
      type: "raw_content",
      title: `Message role: ${role}`,
      raw: msg,
      source: sourceRef(entry, msg),
      visibility: "debug",
    });
  }

  const redactedEvents = events.map(redactEventToolArgs);
  return {
    runId,
    sessionId,
    mode,
    events: redactedEvents,
    summary: computeTrajectorySummary(redactedEvents, capture),
  };
}

export function computeTrajectorySummary(
  events: TrajectoryEvent[],
  capture: CaptureStats = {
    sourceEntryCount: events.length,
    sourceMessageCount: 0,
    sourceContentBlockCount: 0,
    capturedContentBlockCount: 0,
  },
): TrajectorySummary {
  const toolCalls = events.filter((event) => event.type === "tool_call");
  const skillCalls = toolCalls.filter((event) => event.tool?.kind === "skill");
  const evidenceItems = events.flatMap((event) => event.evidence ?? []);
  return {
    totalEvents: events.length,
    turnCount: Math.max(0, ...events.map((event) => event.turnIndex ?? 0)),
    sourceEntryCount: capture.sourceEntryCount,
    sourceMessageCount: capture.sourceMessageCount,
    sourceContentBlockCount: capture.sourceContentBlockCount,
    capturedContentBlockCount: capture.capturedContentBlockCount,
    thinkingCount: events.filter((event) => event.type === "assistant_thinking").length,
    compactionCount: events.filter((event) => event.type === "context_compaction").length,
    toolCallCount: toolCalls.length,
    skillCallCount: skillCalls.length,
    successToolCallCount: events.filter((event) => event.type === "tool_result" && event.status !== "error").length,
    failedToolCallCount: events.filter((event) => event.type === "tool_result" && event.status === "error").length,
    retryCount: events.filter((event) => event.type === "retry").length,
    warningCount: events.filter((event) => event.type === "warning").length,
    toolsUsed: [...new Set(toolCalls.filter((event) => event.tool?.kind !== "skill").map((event) => event.tool?.name).filter(Boolean))] as string[],
    skillsUsed: [...new Set(skillCalls.map((event) => event.tool?.name).filter(Boolean))] as string[],
    evidenceCount: evidenceItems.length,
  };
}

function sourceRef(
  entry: RawEntry,
  msg?: Record<string, unknown>,
  blockIndex?: number,
  blockType?: string,
): TrajectorySourceRef {
  return {
    entryId: typeof entry.id === "string" ? entry.id : undefined,
    parentId: typeof entry.parentId === "string" || entry.parentId === null ? entry.parentId : undefined,
    role: typeof msg?.role === "string" ? msg.role : undefined,
    blockIndex,
    blockType,
    stopReason: typeof msg?.stopReason === "string" ? msg.stopReason : undefined,
    model: typeof msg?.model === "string" ? msg.model : undefined,
    provider: typeof msg?.provider === "string" ? msg.provider : undefined,
    usage: msg?.usage,
  };
}

function contentBlocks(content: unknown): ContentBlock[] {
  if (Array.isArray(content)) return content as ContentBlock[];
  if (content === undefined || content === null) return [];
  return [{ type: "text", text: typeof content === "string" ? content : stringify(content) }];
}

function isToolCallBlock(block: ContentBlock): boolean {
  return ["toolcall", "tool_call", "tooluse", "tool_use"].includes(String(block.type || "").toLowerCase());
}

function isToolResultRole(role: string): boolean {
  return ["toolresult", "tool_result", "tool"].includes(role.toLowerCase());
}

function toolKind(name: string): ToolKind {
  if (/^(bash|shell|powershell|pwsh)$/i.test(name)) return "bash";
  if (/^skill$/i.test(name) || /(?:^|[_:-])skill(?:$|[_:-])/i.test(name)) return "skill";
  return "tool";
}

function extractSkillName(args: unknown, fallback: string): string {
  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    const direct = firstString(record.skillName, record.skill_name, record.skill, record.name);
    if (direct) return direct;
  }
  const serialized = typeof args === "string" ? args : stringify(args);
  return serialized.match(SKILL_NAME_RE)?.[1] || (fallback.toLowerCase() === "skill" ? "unnamed-skill" : fallback);
}

function firstString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === "string" && value.length > 0) || "";
}

/** Preserve every returned content block, including structured/non-text blocks. */
function formatToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content === undefined || content === null ? "" : stringify(content);
  return content.map((block) => {
    if (typeof block === "string") return block;
    if (!block || typeof block !== "object") return String(block ?? "");
    const record = block as Record<string, unknown>;
    const keys = Object.keys(record);
    if (record.type === "text" && typeof record.text === "string" && keys.every((key) => key === "type" || key === "text")) {
      return record.text;
    }
    return stringify(record);
  }).join("\n\n");
}

function contentTextOrRaw(content: unknown): string {
  const text = extractText(content);
  if (text) return text;
  if (content === undefined || content === null) return "";
  return typeof content === "string" ? content : stringify(content);
}

function lastTextBlockIndex(blocks: ContentBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (blocks[index]?.type === "text") return index;
  }
  return -1;
}

function stringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function formatToolArgsPreview(args: unknown): string {
  if (!args || typeof args !== "object") return args === undefined ? "" : String(args);
  const pairs = Object.entries(args as Record<string, unknown>);
  if (pairs.length === 0) return "";
  if (pairs.length === 1) return String(pairs[0]![1]);
  return pairs.map(([key, value]) => `${key}: ${stringify(value)}`).join(", ");
}
