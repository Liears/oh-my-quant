/**
 * Shared types for the artifact module.
 *
 * Contains data models for session parsing, content detection, rendering,
 * and trajectory (per docs/artifacts-design.md sections 7-8).
 */

// ── Public API ──

export interface GenerateArtifactInput { sessionPath: string; title?: string }
export interface GenerateArtifactResult { html: string; title: string; sessionId: string; messageCount: number }

// ── Generator context ──

export interface GenCtx {
  title: string; model?: string;
  dashBody: string[]; trajBody: string[];
  metrics: Card[]; scores: ScoreTable | null;
  factors: FactorBar[]; klines: KlineData[];
  navCharts: NavLineData[];
  compareFactors: FactorSeries[];
  stats: SessionStats;
}

export interface SessionStats {
  turnCount: number;
  toolCallCount: number;
  skillNames: string[];
  firstTs: string; lastTs: string;
}

// ── Detected structured data ──

export interface Card { label: string; value: string; num: number }
export interface ScoreTable { header: string[]; data: string[][] }
export interface FactorBar { label: string; pct: number; value: string; up: boolean }
export interface FactorSeries { name: string; factors: FactorBar[] }
export interface KlineData { header: string[]; rows: OhlcRow[]; timeframe?: string }
export interface OhlcRow { date: string; open: number; high: number; low: number; close: number; vol?: number }
export interface NavLineData { header: string[]; rows: NavRow[] }
export interface NavRow { date: string; nav: number; bm?: number; hs300?: number }

// ── Session parsing ──

export type RawEntry = { type: string } & Record<string, unknown>;
export interface ContentBlock { type?: string; id?: string; text?: string; thinking?: string; name?: string; arguments?: unknown }

// ── Trajectory (docs/artifacts-design.md section 7-8) ──

export type TrajectoryEventType =
  | "user_request"
  | "model_input"
  | "assistant_thinking"
  | "context_compaction"
  | "raw_content"
  | "model_input"
  | "assistant_thinking"
  | "context_compaction"
  | "raw_content"
  | "task_understanding"
  | "plan"
  | "step_start"
  | "tool_call"
  | "tool_result"
  | "observation"
  | "decision"
  | "retry"
  | "warning"
  | "artifact_write"
  | "final_answer";

export interface TrajectoryEvent {
  id: string;
  runId: string;
  sessionId: string;
  parentId?: string;
  stepId?: string;
  /** One-based user turn; zero is pre-conversation context. */
  turnIndex?: number;
  timestamp: string;
  type: TrajectoryEventType;
  title: string;
  summary?: string;
  tool?: TrajectoryToolPayload;
  evidence?: TrajectoryEvidence[];
  raw?: unknown;
  /** Exact location and generation metadata from the persisted JSONL source. */
  source?: TrajectorySourceRef;
  status?: "pending" | "running" | "success" | "error" | "skipped";
  latencyMs?: number;
  visibility: "public" | "debug" | "hidden";
  redaction?: RedactionInfo;
}

export interface TrajectorySourceRef {
  entryId?: string;
  parentId?: string | null;
  role?: string;
  blockIndex?: number;
  blockType?: string;
  stopReason?: string;
  model?: string;
  provider?: string;
  usage?: unknown;
}

export interface TrajectoryToolPayload {
  callId: string;
  name: string;
  kind?: "tool" | "bash" | "skill";
  args: unknown;
  argsPreview?: string;
  resultPreview?: unknown;
  resultDetails?: unknown;
  error?: { name: string; message: string; stack?: string };
}

export interface TrajectoryEvidence {
  id: string;
  sourceType: "tool_result" | "table" | "chart" | "quote" | "metric" | "news" | "financial_report";
  sourceId: string;
  label: string;
  value?: string | number;
  unit?: string;
  confidence?: number;
}

export interface RedactionInfo {
  hasRedaction: boolean;
  fields: string[];
  reason: string;
}

export interface TrajectoryDocument {
  runId: string;
  sessionId: string;
  mode: "compact" | "audit" | "debug" | "raw";
  events: TrajectoryEvent[];
  summary: TrajectorySummary;
}

export interface TrajectorySummary {
  totalEvents: number;
  turnCount: number;
  sourceEntryCount: number;
  sourceMessageCount: number;
  sourceContentBlockCount: number;
  capturedContentBlockCount: number;
  thinkingCount: number;
  compactionCount: number;
  toolCallCount: number;
  skillCallCount: number;
  successToolCallCount: number;
  failedToolCallCount: number;
  retryCount: number;
  warningCount: number;
  totalLatencyMs?: number;
  toolsUsed: string[];
  skillsUsed: string[];
  evidenceCount: number;
}
