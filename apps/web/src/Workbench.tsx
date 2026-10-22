import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./components/Composer.tsx";
import { MarketPanel } from "./components/MarketPanel.tsx";
import { Rail } from "./components/Rail.tsx";
import { Thread } from "./components/Thread.tsx";
import type {
  MarketSnapshot,
  RunState,
  Turn,
  WorkbenchClient,
  WorkspaceIdentity,
  WorkspaceSummary,
} from "./contract.ts";

interface WorkbenchProps {
  readonly client: WorkbenchClient;
}

type Phase = "loading" | "ready" | "error";

const LOADING_MARKET: MarketSnapshot = {
  refreshedAt: new Date().toISOString(),
  quotes: [],
  source: { provider: null, updatedAt: null, available: 0, total: 0 },
};

export function Workbench({ client }: WorkbenchProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [identity, setIdentity] = useState<WorkspaceIdentity | null>(null);
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [market, setMarket] = useState<MarketSnapshot>(LOADING_MARKET);
  const [state, setState] = useState<RunState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Latest load wins: a slow first attempt must not overwrite a retry.
  const attempt = useRef(0);

  const load = useCallback(async () => {
    const current = attempt.current + 1;
    attempt.current = current;
    setPhase("loading");
    setError(null);

    try {
      const [nextIdentity, nextWorkspaces, nextMarket] = await Promise.all([
        client.identity(),
        client.workspaces(),
        client.market(),
      ]);
      const nextTurns = await client.transcript(nextIdentity.sessionId);
      if (attempt.current !== current) return;
      setIdentity(nextIdentity);
      setWorkspaces(nextWorkspaces);
      setMarket(nextMarket);
      setTurns(nextTurns);
      setPhase("ready");
    } catch (cause) {
      if (attempt.current !== current) return;
      setError(cause instanceof Error ? cause.message : "无法读取工作区");
      setPhase("error");
    }
  }, [client]);

  useEffect(() => {
    void load();

    // Releasing the subscription detaches; it must not cancel shared work.
    const release = client.subscribe(event => {
      if (event.type === "turn") {
        setTurns(currentTurns => {
          const index = currentTurns.findIndex(turn => turn.id === event.turn.id);
          if (index === -1) return [...currentTurns, event.turn];
          const next = [...currentTurns];
          next[index] = event.turn;
          return next;
        });
      }
      if (event.type === "state") {
        setIdentity(event.identity);
        setState(event.state);
      }
      if (event.type === "market") setMarket(event.snapshot);
    });

    return release;
  }, [client, load]);

  const activeId = identity?.workspaceId ?? null;

  const submit = useCallback(
    (text: string) => {
      if (!activeId) return;
      setError(null);
      setState("running");
      void client.submit({ workspaceId: activeId, text }).catch(cause => {
        setState("failed");
        setError(cause instanceof Error ? cause.message : "提交失败");
        setPhase("error");
      });
    },
    [activeId, client],
  );

  const cancel = useCallback(() => {
    const runId = identity?.runId;
    if (!runId) return;
    void client.cancel(runId).then(() => setState("cancelled"));
  }, [client, identity?.runId]);

  const crumb = useMemo(() => {
    const workspace = workspaces.find(item => item.workspaceId === activeId);
    return workspace ? `${workspace.code} ${workspace.name}` : "新研究";
  }, [activeId, workspaces]);

  const running = state === "running";

  return (
    <div className="workbench">
      <Rail
        workspaces={workspaces}
        activeId={activeId}
        onSelect={() => undefined}
        onNew={() => undefined}
      />

      <main className="main">
        <header className="main__head">
          <span>WhyJ</span>
          <span>/</span>
          <span>{crumb}</span>
          <span>/</span>
          <span className="main__crumb--current">对话</span>
        </header>

        <div className="main__thread">
          {phase === "loading" ? <p className="empty__body">读取工作区…</p> : null}

          {phase === "error" ? (
            <div className="empty__example" role="alert">
              <p style={{ margin: 0 }}>连接中断：{error ?? "未知原因"}。</p>
              <button type="button" className="composer__send" onClick={() => void load()}>
                重新连接
              </button>
            </div>
          ) : null}

          {phase === "ready" ? <Thread turns={turns} /> : null}
        </div>

        <Composer running={running} onSubmit={submit} onCancel={cancel} />

        <div className="statusbar">
          <span>fixture client</span>
          <span>·</span>
          <span>{market.source.provider ?? "数据源未配置"}</span>
          <span>·</span>
          <span>{workspaces.length} 个工作区</span>
        </div>
      </main>

      <MarketPanel market={market} />
    </div>
  );
}
