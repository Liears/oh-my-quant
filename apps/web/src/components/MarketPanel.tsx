import type { MarketSnapshot } from "../contract.ts";

interface MarketPanelProps {
  readonly market: MarketSnapshot;
}

const EMPTY = "无数据";

function formatValue(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function formatChange(change: number | null): string {
  if (change === null) return EMPTY;
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

export function MarketPanel({ market }: MarketPanelProps) {
  const { source } = market;
  const unavailable = source.available === 0;

  return (
    <aside className="panel">
      <section>
        <div className="section__head">
          <span className="section__bar" aria-hidden="true" />
          概览
        </div>
        <div className="kv">
          <span className="kv__key">状态</span>
          <span className="kv__value" data-tone={unavailable ? "empty" : undefined}>
            {unavailable ? "不可用 · 无数据" : "就绪"}
          </span>
        </div>
        <div className="kv">
          <span className="kv__key">更新</span>
          <span className="kv__value">{new Date(market.refreshedAt).toLocaleString("zh-CN")}</span>
        </div>
      </section>

      <section>
        <div className="section__head">
          <span className="section__bar" aria-hidden="true" />
          行情
        </div>
        {market.quotes.map(quote => (
          <div className="kv" key={quote.code}>
            <span className="kv__key">
              {quote.code} {quote.name}
            </span>
            <span
              className="kv__value"
              data-tone={
                quote.change === null ? "empty" : quote.change > 0 ? "up" : quote.change < 0 ? "down" : undefined
              }
            >
              {quote.change === null ? EMPTY : `${formatValue(quote.value)} ${formatChange(quote.change)}`}
            </span>
          </div>
        ))}
      </section>

      <section>
        <div className="section__head">
          <span className="section__bar" aria-hidden="true" />
          来源
        </div>
        <div className="kv">
          <span className="kv__key">来源</span>
          <span className="kv__value" data-tone={source.provider ? undefined : "empty"}>
            {source.provider ?? EMPTY}
          </span>
        </div>
        <div className="kv">
          <span className="kv__key">更新</span>
          <span className="kv__value" data-tone={source.updatedAt ? undefined : "empty"}>
            {source.updatedAt ?? "—"}
          </span>
        </div>
        <div className="kv">
          <span className="kv__key">覆盖</span>
          <span className="kv__value">
            {source.available}/{source.total} 可用
          </span>
        </div>
        <p className="panel__note">市场刷新未取得数据，右侧不会用占位数字代替。</p>
      </section>
    </aside>
  );
}
