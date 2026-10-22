/**
 * Deterministic stand-in for the Host.
 *
 * The fixture is intentionally boring: it produces the same transcript, the
 * same missing market data and the same timing on every load, so interface
 * states can be screenshotted and diffed. It is replaced by the real client
 * when #46/#75 land; until then it keeps the UI honest about what it does and
 * does not know.
 */
import type {
  MarketSnapshot,
  Release,
  SubmitRequest,
  SubmitResult,
  Turn,
  WorkbenchClient,
  WorkbenchEvent,
  WorkspaceIdentity,
  WorkspaceSummary,
} from "./contract.ts";

const WORKSPACE_ID = "ws-demo-002048";
const SESSION_ID = "session-demo-1";

/** Missing data is represented as null, never as a plausible zero. */
const EMPTY_MARKET: MarketSnapshot = {
  refreshedAt: "2026-10-22T15:27:00+08:00",
  quotes: [
    { code: "000001.SH", name: "上证指数", value: null, change: null },
    { code: "399001.SZ", name: "深证成指", value: null, change: null },
    { code: "000300.SH", name: "沪深300", value: null, change: null },
    { code: "000905.SH", name: "中证500", value: null, change: null },
    { code: "399006.SZ", name: "创业板指", value: null, change: null },
  ],
  source: { provider: null, updatedAt: null, available: 0, total: 5 },
};

const WORKSPACES: readonly WorkspaceSummary[] = [
  {
    workspaceId: WORKSPACE_ID,
    code: "002048.SZ",
    name: "结构跟踪",
    runCount: 0,
    state: "idle",
  },
];

export interface FixtureOptions {
  /** Settlement delay in ms. Tests pass 0; the demo uses the default. */
  readonly settleAfterMs?: number;
}

export function createFixtureClient(options: FixtureOptions = {}): WorkbenchClient {
  const settleAfterMs = options.settleAfterMs ?? 900;
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const transcript: Turn[] = [];
  let identity: WorkspaceIdentity = {
    workspaceId: WORKSPACE_ID,
    sessionId: SESSION_ID,
    runId: null,
  };
  let counter = 0;

  const emit = (event: WorkbenchEvent) => {
    for (const listener of listeners) listener(event);
  };

  const push = (turn: Turn) => {
    const index = transcript.findIndex(candidate => candidate.id === turn.id);
    if (index === -1) transcript.push(turn);
    else transcript[index] = turn;
    emit({ type: "turn", turn });
  };

  const settle = (runId: string, assistantId: string, text: string) => {
    push({ id: assistantId, role: "assistant", text, state: "settled", at: new Date().toISOString() });
    identity = { ...identity, runId: null };
    emit({ type: "state", identity, state: "settled" });
    void runId;
  };

  return {
    async identity() {
      return identity;
    },

    async workspaces() {
      return WORKSPACES;
    },

    async transcript() {
      return [...transcript];
    },

    async market() {
      return EMPTY_MARKET;
    },

    async submit(request: SubmitRequest): Promise<SubmitResult> {
      counter += 1;
      const runId = `run-fixture-${counter}`;
      const userId = `turn-u-${counter}`;
      const assistantId = `turn-a-${counter}`;

      push({ id: userId, role: "user", text: request.text, state: "settled", at: new Date().toISOString() });
      push({ id: assistantId, role: "assistant", text: "", state: "running", at: new Date().toISOString() });

      identity = { workspaceId: request.workspaceId, sessionId: SESSION_ID, runId };
      emit({ type: "state", identity, state: "running" });

      // No model is called: the fixture explains why, rather than inventing an answer.
      setTimeout(() => {
        settle(
          runId,
          assistantId,
          "契约演示：这里本该由 Host 返回研究结论。当前没有连接 Host，所以只完成了提交、运行与结算这条链路。",
        );
      }, settleAfterMs);

      return { sessionId: SESSION_ID, runId };
    },

    async cancel(runId: string) {
      identity = { ...identity, runId: null };
      emit({ type: "state", identity, state: "cancelled" });
      void runId;
    },

    subscribe(listener) {
      listeners.add(listener);
      const release: Release = () => {
        // Detach only. Cancelling is `cancel`, never a side effect of release.
        listeners.delete(listener);
      };
      return release;
    },
  };
}
