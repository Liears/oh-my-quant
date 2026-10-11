import { createHash } from "node:crypto";
import type { QuantAgentEvent, QuantAgentSession } from "../agent/src/session-contracts.ts";
import type { ResearchState } from "../research/state.ts";
import { record } from "../research/references.ts";

export type EvaluationPhase = "research" | "recovery";

/** A prepared payload is not proof of delivery, a provider response, or a billed request. */
export function auditPreparedRequest(api: string, payload: unknown, phase: EvaluationPhase) {
  const serialized = JSON.stringify(payload) ?? "null", body = record(payload);
  const tools = body?.tools === undefined ? [] : body.tools;
  const names = Array.isArray(tools) ? tools.map(tool => record(record(tool)?.function)?.name) : null;
  const mapped = api === "openai-completions" && Array.isArray(body?.messages) && names !== null && names.every(name => typeof name === "string");
  const instructions = mapped ? (body!.messages as unknown[]).map(record).filter(message => message?.role === "system" || message?.role === "developer") : null;
  return { phase, api, scope: "prepared-payload" as const, payloadHash: createHash("sha256").update(serialized).digest("hex"), bytes: Buffer.byteLength(serialized),
    extraction: mapped ? "openai-completions" as const : "unsupported-or-invalid" as const,
    toolNames: mapped ? names as string[] : null,
    toolSchemasHash: mapped ? createHash("sha256").update(JSON.stringify(tools)).digest("hex") : null,
    instructionMessagesHash: instructions ? createHash("sha256").update(JSON.stringify(instructions)).digest("hex") : null };
}

type ToolTrace = { phase: EvaluationPhase; entryId: string | null; callId: string; tool: string } & (
  { type: "call"; arguments: Record<string, unknown> }
  | { type: "result"; isError: boolean; error?: string; taskEvent?: unknown }
);

/** Evaluation-only observations of original journal commits; no duplicate execution or journal writes. */
export class ResearchEvaluationAudit {
  readonly preparedRequests: ReturnType<typeof auditPreparedRequest>[] = [];
  readonly toolTrace: ToolTrace[] = [];
  readonly checkpoints: Array<{ phase: EvaluationPhase; leafId: string | null; task: ResearchState["task"]; taskErrors: ResearchState["taskErrors"];
    operations: Array<{ callEntryId: string; callId: string; tool: string; status: string; reason: string }>; unresolved: ResearchState["unresolved"] }> = [];

  async observe(event: QuantAgentEvent, agent: QuantAgentSession, phase: EvaluationPhase): Promise<void> {
    if (event.type === "before_provider_payload") this.preparedRequests.push(auditPreparedRequest(event.model.api, event.payload, phase));
    if (event.type === "message_end" && event.message.role === "assistant") {
      const calls = event.message.content.filter(part => part.type === "toolCall");
      if (calls.length) {
        const entryId = await agent.getLeafId();
        for (const call of calls) this.toolTrace.push({ type: "call", phase, entryId, callId: call.id, tool: call.name, arguments: structuredClone(call.arguments) });
      }
    }
    if (event.type === "message_end" && event.message.role === "toolResult") {
      const message = event.message;
      this.toolTrace.push({ type: "result", phase, entryId: await agent.getLeafId(), callId: message.toolCallId, tool: message.toolName, isError: message.isError,
        ...(message.isError ? { error: message.content.filter(part => part.type === "text").map(part => part.text).join("\n") } : {}),
        ...(message.toolName === "research_task" && record(message.details)?.event ? { taskEvent: structuredClone(record(message.details)!.event) } : {}) });
    }
    if (event.type === "turn_end") {
      const state = await agent.getResearchState();
      this.checkpoints.push(structuredClone({ phase, leafId: state.leafId, task: state.task, taskErrors: state.taskErrors,
        operations: state.operations.map(({ callEntryId, callId, tool, status, reason }) => ({ callEntryId, callId, tool, status, reason })), unresolved: state.unresolved }));
    }
  }
}
