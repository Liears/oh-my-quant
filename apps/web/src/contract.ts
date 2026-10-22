/**
 * The workbench's view of the Host.
 *
 * This file is the only place the UI learns how work is submitted, cancelled
 * and observed. It exists so #50's interface slice can be built and tested
 * before the Host from #46/#75 lands: swapping `FixtureClient` for the real
 * client must not change a single component.
 *
 * Two rules are encoded here rather than in prose:
 *
 * 1. Observations are subscriptions. `subscribe` returns a release function
 *    that only detaches the listener; it never cancels the run. Cancelling is
 *    a separate, explicit command.
 * 2. A run is identified by workspace, session and run, not by a component
 *    instance. Switching sessions detaches; it does not end work.
 */

export type RunState = "idle" | "running" | "settled" | "failed" | "cancelled";

export interface WorkspaceIdentity {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly runId: string | null;
}

export interface WorkspaceSummary {
  readonly workspaceId: string;
  readonly code: string;
  readonly name: string;
  readonly runCount: number;
  readonly state: RunState;
}

export type TurnRole = "user" | "assistant";

export interface Turn {
  readonly id: string;
  readonly role: TurnRole;
  readonly text: string;
  readonly state: RunState;
  readonly at: string;
}

export interface MarketQuote {
  readonly code: string;
  readonly name: string;
  readonly value: number | null;
  readonly change: number | null;
}

export interface SourceStatus {
  readonly provider: string | null;
  readonly updatedAt: string | null;
  readonly available: number;
  readonly total: number;
}

export interface MarketSnapshot {
  readonly refreshedAt: string;
  readonly quotes: readonly MarketQuote[];
  readonly source: SourceStatus;
}

export interface SubmitRequest {
  readonly workspaceId: string;
  readonly text: string;
}

export interface SubmitResult {
  readonly sessionId: string;
  readonly runId: string;
}

/**
 * Events are coarse on purpose: the Host decides how much detail to stream,
 * and the UI must not assume it receives provider-level deltas.
 */
export type WorkbenchEvent =
  | { readonly type: "turn"; readonly turn: Turn }
  | { readonly type: "state"; readonly identity: WorkspaceIdentity; readonly state: RunState }
  | { readonly type: "market"; readonly snapshot: MarketSnapshot };

export type Release = () => void;

export interface WorkbenchClient {
  identity(): Promise<WorkspaceIdentity>;
  workspaces(): Promise<readonly WorkspaceSummary[]>;
  transcript(sessionId: string): Promise<readonly Turn[]>;
  market(): Promise<MarketSnapshot>;
  submit(request: SubmitRequest): Promise<SubmitResult>;
  /** Explicit user intent. Releasing a subscription must never do this. */
  cancel(runId: string): Promise<void>;
  subscribe(listener: (event: WorkbenchEvent) => void): Release;
}
