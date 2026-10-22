import { useCallback, useEffect, useMemo, useState } from "react";
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

const LOADING_MARKET: MarketSnapshot = {
  refreshedAt: new Date().toISOString(),
  quotes: [],
  source: { provider: null, updatedAt: null, available: 0, total: 0 },
};

export function Workbench({ client }: WorkbenchProps) {
  const [identity, setIdentity] = useState<WorkspaceIdentity | null>(null);
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [market, setMarket] = useState<MarketSnapshot>(LOADING_MARKET);
  const [state, setState] = useState<RunState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const [nextIdentity, nextWorkspaces, nextMarket] = await Promise.all([
          client.identity(),
          client.workspaces(),
          client.market(),
        ]);
        if (!active) return;
        setIdentity(nextIdentity);
        setWorkspaces(nextWorkspaces);
        setMarket(nextMarket);
        setTurns(await client.transcript(nextIdentity.sessionId));
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取工作区");
      }
    })();

    // Releasing the subscription detaches; it must not cancel shared work.
    const release = client.subscribe(event => {
      if (event.type === "turn") {
        setTurns(current => {
          const index = current.findIndex(turn => turn.id === event.turn.id);
          if (index === -1) return [...current, event.turn];
          const next = [...current];
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

    return () => {
      active = false;
      release();
    };
  }, [client]);

  const activeId = identity?.workspaceId ?? null;

  const submit = useCallback(
    (text: string) => {
      if (!activeId) return;
      setError(null);
      setState("running");
      void client.submit({ workspaceId: activeId, text }).catch(cause => {
        setState("failed");
        setError(cause instanceof Error ? cause.message : "提交失败");
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
          {error ? (
            <p className="empty__example" role="alert">
              连接中断：{error}。重新载入可继续。
            </p>
          ) : null}
          <Thread turns={turns} />
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
