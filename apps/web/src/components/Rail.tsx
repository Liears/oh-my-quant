import type { WorkspaceSummary } from "../contract.ts";

interface RailProps {
  readonly workspaces: readonly WorkspaceSummary[];
  readonly activeId: string | null;
  readonly onSelect: (workspaceId: string) => void;
  readonly onNew: () => void;
}

export function Rail({ workspaces, activeId, onSelect, onNew }: RailProps) {
  return (
    <aside className="rail">
      <div className="rail__brand">
        <span className="rail__mark">JQ</span>
        <span className="rail__name">WhyJ Quant</span>
        <span className="rail__version">0.1.0</span>
      </div>

      <button type="button" className="rail__new" onClick={onNew}>
        + 新建研究
      </button>

      <div>
        <div className="label">研究项目 · {workspaces.length}</div>
        <ul className="rail__list">
          {workspaces.map(workspace => (
            <li key={workspace.workspaceId}>
              <button
                type="button"
                className="rail__item"
                data-active={workspace.workspaceId === activeId}
                onClick={() => onSelect(workspace.workspaceId)}
              >
                <span className="rail__item-code">{workspace.code}</span>
                <span>{workspace.name}</span>
                <span className="rail__item-count">{workspace.runCount}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rail__foot">
        <div>本机服务 · 单股日线研究</div>
        <div>证据与版本保存在本机</div>
      </div>
    </aside>
  );
}
