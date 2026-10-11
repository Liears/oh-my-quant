import { isDeepStrictEqual } from "node:util";
import { record } from "./references.ts";
import type { ResearchEntry, ResearchState } from "./state.ts";
import type { ResearchTaskEvent, ResearchTaskSpec } from "../types/research-task.ts";

/** A copyable precondition for an undeclared task, bound to its actual user entry. */
export function initialResearchTaskRevision(requestEntryId: string): string {
  return `initial:${requestEntryId}`;
}

/** Resolve the original user text and first-study ID from its journal entry. */
export function researchTaskAction(value: unknown, requests: ResearchState["requests"]): ResearchTaskEvent | null {
  const input = record(value);
  if (input?.action === "read") return null;
  if (!input || !["declare", "resolve", "cancel"].includes(String(input.action))
    || input.expectedRevision !== null && typeof input.expectedRevision !== "string") throw new Error("Invalid research task action. Use declare/resolve/cancel with the observed expectedRevision; the first declaration requires explicit JSON null.");
  if (input.action === "declare") {
    const request = requests.at(-1);
    if (!request || request.entryId !== input.requestEntryId) throw new Error("Read the current task first and use its latest requestEntryId.");
    const task = record(input.task);
    if (!task) throw new Error("A task declaration is required.");
    // Historical journal calls with JSON null remain readable; current tools issue a string token.
    const expectedRevision = input.expectedRevision === initialResearchTaskRevision(request.entryId) ? null : input.expectedRevision;
    if (task.id === undefined && expectedRevision !== null) {
      throw new Error("A revised task must keep its observed task.id; only the first declaration may omit it.");
    }
    return { version: 1, type: "declare", expectedRevision,
      task: { ...task, id: task.id === undefined ? `study-${request.entryId}` : task.id,
        request: request.text } as unknown as ResearchTaskSpec };
  }
  if (typeof input.expectedRevision !== "string" || typeof input.reason !== "string" || !input.reason.trim()) throw new Error("An observed task revision and reason are required.");
  if (input.action === "cancel") return { version: 1, type: "cancel", expectedRevision: input.expectedRevision, reason: input.reason };
  const from = record(input.from), to = record(input.to);
  if (!from || !to || typeof from.callEntryId !== "string" || typeof from.callId !== "string"
    || typeof to.callEntryId !== "string" || typeof to.callId !== "string") throw new Error("Both retry attempt references are required.");
  return { version: 1, type: "resolve", expectedRevision: input.expectedRevision, reason: input.reason,
    from: { callEntryId: from.callEntryId, callId: from.callId }, to: { callEntryId: to.callEntryId, callId: to.callId } };
}

/** A successful, uniquely matched tool result is the commit record, not the assistant call. */
export function recordedResearchTaskAction(entry: ResearchEntry, entries: ResearchEntry[]): ResearchTaskEvent | null {
  const message = record(entry.message);
  if (entry.type !== "message" || message?.role !== "toolResult" || message.toolName !== "research_task" || message.isError) return null;
  const resultIndex = entries.indexOf(entry);
  const calls = entries.flatMap((candidate, index) => {
    const source = candidate.type === "message" ? record(candidate.message) : undefined;
    return source?.role === "assistant" && Array.isArray(source.content)
      ? source.content.map(record).filter(block => block?.type === "toolCall" && block.id === message.toolCallId).map(block => ({ block: block!, index })) : [];
  });
  const results = entries.filter(candidate => {
    const result = candidate.type === "message" ? record(candidate.message) : undefined;
    return result?.role === "toolResult" && result.toolCallId === message.toolCallId;
  });
  const call = calls[0];
  if (calls.length !== 1 || results.length !== 1 || !call || call.index >= resultIndex || call.block.name !== "research_task") throw new Error("Ambiguous or mismatched research task call/result.");
  const requests = entries.slice(0, call.index).flatMap(candidate => {
    const request = candidate.type === "message" ? record(candidate.message) : undefined;
    if (request?.role !== "user" && request?.role !== "displayUser") return [];
    const text = typeof request.displayText === "string" ? request.displayText : typeof request.content === "string" ? request.content
      : Array.isArray(request.content) ? request.content.map(record).filter(part => part?.type === "text" && typeof part.text === "string").map(part => part!.text).join("\n") : "";
    return [{ entryId: candidate.id, text }];
  });
  const event = researchTaskAction(call.block.arguments, requests);
  if (event && !isDeepStrictEqual(record(message.details)?.event, event)) throw new Error("Research task result differs from the submitted action or original request.");
  return event;
}
