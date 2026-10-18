import type { Api, ImageContent, Model } from '@earendil-works/pi-ai';
import type { AgentEvent, AgentMessage, AgentTool, AgentHarnessOptions, AgentHarnessStreamOptions, CompactResult, ExecutionEnv, JsonlSessionMetadata, NavigateTreeResult, SessionContext, SessionTreeEntry, ThinkingLevel } from './session-runtime/index.ts';
import type { JsonlSessionRepoApi, ToolCallEvent, ToolCallResult } from './session-runtime/harness/types.ts';
import type { SessionCtx } from './context.ts';
import type { OhQuantSettings } from '../../types/config.ts';
import type { QuantSkill } from './skills.ts';
import type { ReportProvenance } from '../../types/research-evidence.ts';
import type { ResearchState } from '../../research/state.ts';
import type { ResearchEntry } from '../../research/state.ts';
import type { ResearchReport } from '../../research/types.ts';
import type { SkillRequirementCheck } from '../../types/skills.ts';

export interface QuantModelState {
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
}

/** One connection snapshot, including lazy auth bound to the same endpoint/configuration. */
export interface QuantModelConnection extends QuantModelState {
  getAuth: NonNullable<AgentHarnessOptions["getApiKeyAndHeaders"]>;
  compactTriggerTokens: number;
  /** Optional legacy restoration policy; explicit connections normally keep current settings. */
  restore?: (context: SessionContext) => QuantModelState;
}

export interface QuantAgentDependencies {
  env: ExecutionEnv;
  sessions: Pick<JsonlSessionRepoApi, "create" | "open" | "list">;
  tools: readonly AgentTool[];
  /** Atomic host registry snapshot; applied only at an idle independent-request boundary. */
  readTools?(): { revision: string; tools: readonly AgentTool[]; skills?: readonly QuantSkill[]; capabilities?: Readonly<Record<string, SkillRequirementCheck>> };
  readConnection(): QuantModelConnection;
  loadSkills(): Promise<QuantSkill[]>;
  /** Opt into idle resource refresh; change this token after publishing new skill content. */
  readSkillRevision?(): string;
  /** Trusted capability facts. The preparer remains responsible for fail-closed policy. */
  readSkillCapabilities?(): Readonly<Record<string, SkillRequirementCheck>>;
  /** Pure host policy evaluated against the currently active tools, before publishing resources. */
  prepareSkills?(skills: QuantSkill[], tools: AgentTool[], capabilities?: Readonly<Record<string, SkillRequirementCheck>>): QuantSkill[];
  /** Pure task policy over the committed branch and the idle host/skill snapshot. */
  prepareRequestResources?(input: { research: ResearchState; skills: QuantSkill[]; rawSkills: QuantSkill[] }): { activeToolNames: string[]; skills: QuantSkill[] };
  /** Host policy over validated tool arguments, before the tool executes. */
  beforeToolCall?(call: ToolCallEvent): Promise<ToolCallResult | undefined> | ToolCallResult | undefined;
  prompts: {
    system(input: { skills: QuantSkill[]; tools: AgentTool[] }): string;
    turn(input: string, context: SessionCtx): string;
    skill(name: string, additionalInstructions?: string): string;
  };
  verifyResearch(input: { lines: ResearchEntry[] }): ResearchReport;
  /** Inspect a fixed report revision and its saved provenance; absent port leaves report-required tasks unverified. */
  verifyReport?(ref: string, provenance: Record<string, unknown>): boolean;
}

export interface QuantAgentContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number | null;
}

export interface QuantAgentQueueUpdateEvent {
  type: "queue_update";
  steer: AgentMessage[];
  followUp: AgentMessage[];
  nextTurn: AgentMessage[];
}

export interface QuantAgentBeforeProviderRequestEvent {
  type: "before_provider_request";
  model: Model<any>;
  sessionId: string;
  streamOptions: AgentHarnessStreamOptions;
}

export interface QuantAgentBeforeProviderPayloadEvent {
  type: "before_provider_payload";
  model: Model<any>;
  payload: unknown;
}

export interface QuantAgentAfterProviderResponseEvent {
  type: "after_provider_response";
  status: number;
  headers: Record<string, string>;
}

export type QuantAgentEvent =
  | AgentEvent
  | QuantAgentQueueUpdateEvent
  | QuantAgentBeforeProviderRequestEvent
  | QuantAgentBeforeProviderPayloadEvent
  | QuantAgentAfterProviderResponseEvent;

export interface QuantAgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: string;
  tools: AgentTool[];
  messages: AgentMessage[];
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  /** Live thinking text extracted from the streaming assistant message. */
  thinkingText: string;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
}

export interface QuantAgentImageOptions {
  /** Explicit user-selected chart pixels; retained only for the current operation. */
  images?: readonly ImageContent[];
  signal?: AbortSignal;
}

export interface QuantAgentSession {
  readonly state: QuantAgentState;
  updateContext(update: Partial<SessionCtx>): void;
  subscribe(listener: (event: QuantAgentEvent, signal?: AbortSignal) => Promise<void> | void): () => void;
  prompt(input: string, options?: QuantAgentImageOptions & { displayText?: string }): Promise<void>;
  waitForIdle(): Promise<void>;
  appendContextNote(customType: string, content: string, details?: unknown): Promise<void>;
  steer(message: AgentMessage): Promise<void>;
  followUp(message: AgentMessage): Promise<void>;
  skill(name: string, additionalInstructions?: string, options?: QuantAgentImageOptions): Promise<void>;
  compact(customInstructions?: string): Promise<CompactResult>;
  navigateTree(
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
  ): Promise<NavigateTreeResult>;
  getContextUsage(): QuantAgentContextUsage | undefined;
  getSessionMetadata(): Promise<JsonlSessionMetadata | null>;
  getSessionEntries(): Promise<SessionTreeEntry[]>;
  getSessionBranch(fromId?: string): Promise<SessionTreeEntry[]>;
  getResearchState(): Promise<ResearchState>;
  getLeafId(): Promise<string | null>;
  listSessions(): Promise<JsonlSessionMetadata[]>;
  resumeSession(sessionId: string, options?: { report?: ReportProvenance }): Promise<JsonlSessionMetadata>;
  getSkills(): Promise<QuantSkill[]>;
  abort(): void;
  clearAllQueues(): void;
  reset(): void;
}

/** Core session creation requires complete host ports; no implicit application setup. */
export interface QuantSessionOptions {
  cwd?: string;
  dependencies: QuantAgentDependencies;
}

export interface QuantAgentOptions {
  cwd?: string;
  sessionsRoot?: string;
  settings?: Partial<Pick<OhQuantSettings, "env" | "model" | "thinkingLevel" | "skillIntegrations" | "provider" | "providers">>;
  skillPaths?: string[] | (() => string[]);
  /** Full host composition. When supplied, local settings, discovery and repo defaults are not used. */
  dependencies?: QuantAgentDependencies;
}
