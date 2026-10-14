import type { Market } from "./data.ts";

export interface ResearchTaskSpec {
  id: string;
  /** Original caller instruction, distinct from the declared acceptance criteria. */
  request: string;
  goal: string;
  scope: { symbols: string[]; market: Market | "mixed"; start: string; end: string; benchmark?: string; portfolioRevision?: string; groupIds?: string[] };
  constraints: { allowedTools: string[]; notes: string[] };
  dataRefs: Array<{ kind: "daily-bars" | "fund-nav"; symbol: string; revision: string; contentHash: string }>;
  criteria: Array<{ id: string; description: string; tool: string; parameters: Record<string, unknown>; metrics: string[] }>;
  reportRequired: boolean;
}

export interface ResearchAttemptRef { callEntryId: string; callId: string }

export type ResearchTaskEvent =
  | { version: 1; type: "declare"; expectedRevision: string | null; task: ResearchTaskSpec }
  | { version: 1; type: "resolve"; expectedRevision: string; from: ResearchAttemptRef; to: ResearchAttemptRef; reason: string }
  | { version: 1; type: "cancel"; expectedRevision: string; reason: string };

export interface ResearchTaskState {
  spec: ResearchTaskSpec;
  revision: string;
  startedEntryId: string;
  status: "active" | "blocked" | "complete" | "cancelled";
  criteria: Array<{ id: string; status: "pending" | "blocked" | "satisfied"; reason: string; evidence: ResearchAttemptRef | null }>;
  resolutions: Array<{ entryId: string; from: ResearchAttemptRef; to: ResearchAttemptRef; reason: string; active: boolean }>;
  unresolved: ResearchAttemptRef[];
  reportRef: string | null;
  reportEntryId: string | null;
  /** null means no bound report or no host availability checker was supplied. */
  reportAvailable: boolean | null;
  reasons: string[];
}

/** Read-only projection consumed by local commands and terminal task inspection. */
export interface ResearchTaskSnapshot {
  leafId: string | null;
  task: ResearchTaskState | null;
  taskErrors: Array<{ entryId: string; reason: string }>;
  unresolved: Array<{ callEntryId: string; callId: string; tool: string; reason: string; capabilityAvailable: boolean }>;
}
