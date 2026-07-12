import type { DoctorResult } from "../runtime/doctor-contract.ts";

export interface ParsedCommand {
  command: string;
  raw: string;
  flags: Record<string, string | number | boolean>;
  positional: string[];
}

export type CommandEffect =
  | { type: "clearConversation" }
  | { type: "resetAgent" }
  | { type: "openConfig" }
  | { type: "openDoctor"; doctor?: unknown }
  | { type: "openResume" }
  | { type: "openSession" }
  | { type: "openPortfolio" }
  | { type: "openHelp" }
  | { type: "openArtifact" }
  | { type: "compactSession" }
  | { type: "sessionChanged" }
  | { type: "portfolioChanged" };

export interface CommandSkill {
  name: string;
  description: string;
  filePath: string;
  scope: "project" | "user";
  source: "agents" | "claude" | "codex" | "pi";
  disableModelInvocation?: boolean;
}

export interface CommandCompactResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
}

export interface CommandSessionMetadata {
  id: string;
  createdAt: string;
  cwd: string;
  path: string;
  parentSessionPath?: string;
}

export interface CommandContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number | null;
}

export interface CommandAgentSession {
  readonly state?: unknown;
  waitForIdle(): Promise<void>;
  appendContextNote?(customType: string, content: string, details?: unknown): Promise<void>;
  compact(customInstructions?: string): Promise<CommandCompactResult>;
  listSessions(): Promise<CommandSessionMetadata[]>;
  getSessionMetadata(): Promise<CommandSessionMetadata | null>;
  resumeSession(sessionId: string): Promise<CommandSessionMetadata>;
  getContextUsage(): CommandContextUsage | undefined;
  getSkills(): Promise<CommandSkill[]>;
  skill(name: string, additionalInstructions?: string): Promise<void>;
  subscribe?: unknown;
  prompt?: unknown;
  steer?: unknown;
  followUp?: unknown;
  navigateTree?: unknown;
  getSessionEntries?: unknown;
  getSessionBranch?: unknown;
  getLeafId?: unknown;
  abort?: unknown;
  clearAllQueues?: unknown;
  reset?: unknown;
}

export interface CommandContext {
  /** When set, /config opens the settings panel. */
  openConfig?: () => void;
  /** When set, /doctor opens the doctor panel. */
  openDoctor?: (doctor?: unknown) => void;
  /** Current doctor snapshot for partial retries inside TUI. */
  currentDoctor?: DoctorResult | null;
  /** When set, /resume opens the resume panel. */
  openResume?: () => void;
  /** When set, /portfolio opens the portfolio panel. */
  openPortfolio?: () => void;
  /** When set, /help opens the help panel. */
  openHelp?: () => void;
  /** When set, /artifact opens the artifact panel. */
  openArtifact?: () => void;
  openSession?: () => void;
  /** Active agent session for session/harness commands. */
  agentSession?: CommandAgentSession | null;
  /** Overrides local file opening for tests or non-desktop runtimes. */
  openFile?: (path: string) => void;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
  renderAs?: "text" | "table" | "card";
  effects?: CommandEffect[];
}

export type CommandHandler = (
  flags: Record<string, string | number | boolean>,
  positional: string[],
  ctx: CommandContext,
) => Promise<CommandResult>;
