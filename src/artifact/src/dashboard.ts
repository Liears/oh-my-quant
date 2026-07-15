/** Quant-only research dashboard. Execution data belongs exclusively to Trajectory. */
import type { GenCtx, NavLineData } from "./types.ts";
import { esc } from "./template.ts";
import { renderComparisonRadar, renderEchartsKline, renderFactorRadar } from "./renderers.ts";

export function renderDashboardOverview(ctx: GenCtx): string {
  const hasKline = ctx.klines.length > 0;
  const hasNav = ctx.navCharts.length > 0;
  const hasPrimaryChart = hasKline || hasNav;
  const primary = hasKline
    ? renderEchartsKline(ctx.klines)
    : hasNav
      ? renderNavOverview(ctx.navCharts[0]!)
      : renderQuantEmpty("NO PRICE SERIES", "当前会话没有检测到 OHLC 或净值时间序列。Dashboard 不会使用执行轨迹代替量化图表。");
  const primaryKind = hasKline ? "K-LINE / OHLCV" : hasNav ? "PERFORMANCE / NAV" : "QUANT DATA REQUIRED";

  const hasFactorChart = ctx.compareFactors.length >= 2 || ctx.factors.length >= 3;
  const secondary = ctx.compareFactors.length >= 2
    ? renderComparisonRadar(ctx.compareFactors)
    : ctx.factors.length >= 3
      ? renderFactorRadar(ctx.factors)
      : renderMetricOverview(ctx);

  const dataCount = quantDatasetCount(ctx);
  return `<div class="research-board" data-quant-dashboard="true" data-chart-state="${hasPrimaryChart || hasFactorChart ? "available" : "empty"}">
    <header class="board-head">
      <div><span class="board-kicker">${primaryKind}</span><h2>Quant decision surface</h2><p>仅展示价格曲线、业绩、风险、因子与市场指标。</p></div>
      <div class="board-head-status"><i></i><span>QUANT DATA</span><b>${dataCount} SETS</b></div>
    </header>
    ${renderKpiTape(ctx)}
    <div class="board-grid">
      <section class="board-panel board-primary"><div class="board-panel-head"><span>PRIMARY MONITOR</span><small>${primaryKind}</small></div>${primary}</section>
      <aside class="board-panel board-decision">${renderDecisionPanel(ctx)}</aside>
      <section class="board-panel board-secondary"><div class="board-panel-head"><span>${hasFactorChart ? "FACTOR / RISK MAP" : "QUANT METRICS"}</span><small>${hasFactorChart ? "SIGNAL MAP" : "DETECTED VALUES"}</small></div>${secondary}</section>
      <section class="board-panel board-metrics">${renderCoveragePanel(ctx)}</section>
    </div>
  </div>`;
}

function renderKpiTape(ctx: GenCtx): string {
  const market = marketSnapshot(ctx);
  const risk = ctx.metrics.find((metric) => /回撤|drawdown|risk|风险|volatility|波动|var/i.test(metric.label));
  const factorAverage = ctx.factors.length > 0
    ? ctx.factors.reduce((sum, factor) => sum + factor.pct, 0) / ctx.factors.length
    : null;
  const coverage = quantDatasetCount(ctx);
  const cells = [
    { label: market.label, value: market.value, note: market.note, tone: market.tone },
    { label: "RISK MARKER", value: risk?.value ?? "N/A", note: risk?.label ?? "no explicit risk metric", tone: risk && risk.num < 0 ? "negative" : "neutral" },
    { label: "FACTOR SCORE", value: factorAverage === null ? "N/A" : factorAverage.toFixed(1), note: factorAverage === null ? "awaiting factor data" : `${ctx.factors.length} factors`, tone: factorAverage === null ? "neutral" : factorAverage >= 50 ? "positive" : "negative" },
    { label: "DATA COVERAGE", value: String(coverage), note: `${ctx.klines.length} OHLC · ${ctx.navCharts.length} NAV · ${ctx.metrics.length} metrics`, tone: coverage > 0 ? "positive" : "neutral" },
  ];
  return `<div class="board-kpis">${cells.map((cell) => `<div class="board-kpi ${cell.tone}"><span>${esc(cell.label)}</span><b>${esc(cell.value)}</b><small>${esc(cell.note)}</small></div>`).join("")}</div>`;
}

function marketSnapshot(ctx: GenCtx): { label: string; value: string; note: string; tone: string } {
  const kline = ctx.klines[0];
  if (kline && kline.rows.length > 0) {
    const latest = kline.rows[kline.rows.length - 1]!;
    const previous = kline.rows[kline.rows.length - 2];
    const change = previous ? (latest.close - previous.close) / previous.close * 100 : 0;
    return { label: "LATEST CLOSE", value: formatNumber(latest.close), note: `${change >= 0 ? "+" : ""}${change.toFixed(2)}% · ${latest.date}`, tone: change >= 0 ? "positive" : "negative" };
  }
  const nav = ctx.navCharts[0];
  if (nav && nav.rows.length > 0) {
    const first = nav.rows[0]!;
    const latest = nav.rows[nav.rows.length - 1]!;
    const change = first.nav === 0 ? 0 : (latest.nav / first.nav - 1) * 100;
    return { label: "LATEST NAV", value: formatNumber(latest.nav), note: `${change >= 0 ? "+" : ""}${change.toFixed(2)}% period return`, tone: change >= 0 ? "positive" : "negative" };
  }
  return { label: "MARKET SERIES", value: "N/A", note: "no OHLC or NAV detected", tone: "neutral" };
}

function renderDecisionPanel(ctx: GenCtx): string {
  const market = marketSnapshot(ctx);
  const risk = ctx.metrics.find((metric) => /回撤|drawdown|risk|风险|volatility|波动|var/i.test(metric.label));
  const status = risk && risk.num < 0 || market.tone === "negative" ? "WATCH" : market.tone === "positive" ? "CONSTRUCTIVE" : "AWAIT DATA";
  const statusTone = status === "WATCH" ? "negative" : status === "CONSTRUCTIVE" ? "positive" : "neutral";
  const bullets = [
    ctx.klines.length > 0 ? `${ctx.klines[0]!.rows.length} candles · ${ctx.klines.length} timeframes` : "No OHLC series detected",
    ctx.navCharts.length > 0 ? `${ctx.navCharts[0]!.rows.length} NAV observations` : "No NAV series detected",
    `${ctx.metrics.length} metrics · ${ctx.factors.length} factors`,
    `${ctx.compareFactors.length} comparison series`,
  ];
  return `<div class="board-panel-head"><span>QUANT SNAPSHOT</span><small>NOW</small></div>
    <div class="decision-state ${statusTone}"><span>STANCE</span><b>${status}</b><i></i></div>
    <div class="decision-number"><span>${esc(market.label)}</span><strong>${esc(market.value)}</strong><small>${esc(market.note)}</small></div>
    <ul class="decision-list">${bullets.map((bullet) => `<li><i></i><span>${esc(bullet)}</span></li>`).join("")}</ul>
    <div class="decision-foot"><span>Quant dataset</span><b>${quantDatasetCount(ctx) > 0 ? "AVAILABLE" : "EMPTY"}</b></div>`;
}

function renderCoveragePanel(ctx: GenCtx): string {
  const rows = [
    ["OHLC / K-LINE", ctx.klines.length],
    ["NAV / PERFORMANCE", ctx.navCharts.length],
    ["FACTOR SERIES", ctx.factors.length],
    ["COMPARISON SETS", ctx.compareFactors.length],
    ["QUANT METRICS", ctx.metrics.length],
  ] as const;
  return `<div class="board-panel-head"><span>DATA COVERAGE</span><small>QUANT ONLY</small></div><div class="quant-coverage">${rows.map(([label, value]) => `<div><span>${label}</span><b>${value}</b><i class="${value > 0 ? "on" : ""}"></i></div>`).join("")}</div>`;
}

function renderMetricOverview(ctx: GenCtx): string {
  if (ctx.metrics.length === 0) return renderQuantEmpty("NO QUANT METRICS", "当前会话没有检测到可展示的风险、收益或估值指标。");
  return `<div class="quant-metrics">${ctx.metrics.slice(0, 12).map((metric) => `<div class="quant-metric-row"><span>${esc(metric.label)}</span><b>${esc(metric.value)}</b></div>`).join("")}</div>`;
}

function renderQuantEmpty(title: string, message: string): string {
  return `<div class="quant-empty"><i></i><b>${esc(title)}</b><p>${esc(message)}</p></div>`;
}

function quantDatasetCount(ctx: GenCtx): number {
  return ctx.klines.length + ctx.navCharts.length + ctx.factors.length + ctx.compareFactors.length + ctx.metrics.length;
}

function renderNavOverview(nav: NavLineData): string {
  const width = 1000;
  const height = 520;
  const left = 62;
  const right = 36;
  const top = 44;
  const bottom = 58;
  const rows = nav.rows;
  const series = [
    { name: "PRODUCT", values: rows.map((row) => row.nav), cls: "nav-product" },
    ...(rows.some((row) => row.bm !== undefined) ? [{ name: "BENCHMARK", values: rows.map((row) => row.bm ?? null), cls: "nav-benchmark" }] : []),
    ...(rows.some((row) => row.hs300 !== undefined) ? [{ name: "CSI 300", values: rows.map((row) => row.hs300 ?? null), cls: "nav-index" }] : []),
  ];
  const numeric = series.flatMap((item) => item.values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const spread = max - min || Math.max(Math.abs(max) * .02, 1);
  const low = min - spread * .08;
  const high = max + spread * .08;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index: number) => left + index / Math.max(1, rows.length - 1) * plotWidth;
  const y = (value: number) => top + (high - value) / (high - low) * plotHeight;
  const paths = series.map((item) => `<path d="${linePath(item.values, x, y)}" class="nav-line ${item.cls}"/>`).join("");
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const gy = top + plotHeight * ratio;
    const value = high - (high - low) * ratio;
    return `<line x1="${left}" y1="${gy}" x2="${width - right}" y2="${gy}" class="activity-grid"/><text x="${left - 10}" y="${gy + 4}" text-anchor="end" class="activity-axis">${formatNumber(value)}</text>`;
  }).join("");
  const dateLabels = [0, Math.floor((rows.length - 1) / 2), rows.length - 1].filter((index, position, values) => index >= 0 && values.indexOf(index) === position).map((index) => `<text x="${x(index)}" y="${height - 20}" text-anchor="${index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}" class="activity-axis">${esc(rows[index]!.date.slice(-10))}</text>`).join("");
  const legend = series.map((item, index) => `<circle cx="${left + index * 128}" cy="18" r="4" class="${item.cls}"/><text x="${left + 10 + index * 128}" y="22">${item.name}</text>`).join("");
  const raw = esc(nav.header.join("  ") + "\n" + rows.map((row) => `${row.date}  ${row.nav}${row.bm === undefined ? "" : `  ${row.bm}`}${row.hs300 === undefined ? "" : `  ${row.hs300}`}`).join("\n"));
  return `<div class="nav-overview"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Fund performance line chart">${grid}${paths}<g class="activity-legend">${legend}</g>${dateLabels}</svg><details class="board-raw"><summary>RAW SERIES · ${rows.length} OBSERVATIONS</summary><pre>${raw}</pre></details></div>`;
}

function linePath(values: Array<number | null>, x: (index: number) => number, y: (value: number) => number): string {
  let active = false;
  return values.map((value, index) => {
    if (value === null || !Number.isFinite(value)) { active = false; return ""; }
    const command = active ? "L" : "M";
    active = true;
    return `${command}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
  }).join(" ");
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
