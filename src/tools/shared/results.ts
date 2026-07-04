import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { ERRORS, formatError, type ErrorCode } from "../../types/errors.ts";

export function ok(text: string, details?: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text }], details: details ?? {} };
}

export function err(code: ErrorCode, detail?: string): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text: formatError(ERRORS[code], detail) }], details: {} };
}
