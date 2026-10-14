/**
 * Analytics dock panel — right sidebar assembly.
 * Renders session stats, market summary, risk metrics, benchmark, factors.
 */
import { esc } from "./template.ts";
import type { GenCtx } from "./types.ts";
// Import renderers needed by dock
import { renderScoreTable, renderComparisonRadar, renderFactorRadar } from "./renderers.ts";
import { displayedMovement } from "../../types/metric-semantics.ts";
import { metricValueClass } from "./semantic-colors.ts";
import type { InstrumentLookupUrl } from "./source-links.ts";

export function renderDock(ctx: GenCtx, quantModel: string, sourceUrls?: InstrumentLookupUrl[]): string {
  const sections: string[] = [];

  // ── Agent Stats ──
  const s = ctx.stats;
  const elapsed = s.firstTs && s.lastTs ? elapsedStr(s.firstTs, s.lastTs) : "-";
  let sessionBody = `<div class="mgrid st-grid">${metricCard("engine", "Engine", esc(quantModel), "sm")}${metricCard("model", "Model", esc(ctx.model || "-"), "sm")}${metricCard("turns", "Turns", String(s.turnCount))}${metricCard("tools", "Tools", String(s.toolCallCount))}${metricCard("clock", "Elapsed", elapsed, "sm")}</div>`;
  if (s.skillNames.length > 0) {
    sessionBody += `<div class="skill-strip"><span class="metric-icon">${icon("signal")}</span><span>${s.skillNames.map((n) => esc(n)).join(" · ")}</span></div>`;
  }
  sections.push(dockSection("Session intelligence", "session", sessionBody));

  // ── Market ──
  if (ctx.klines.length > 0 || ctx.metrics.length > 0 || ctx.scores || ctx.factors.length > 0) {
    if (ctx.klines.length > 0) {
      const k0 = ctx.klines[0]!;
      const last = k0.rows[k0.rows.length - 1]!;
      const prev = k0.rows[k0.rows.length - 2]!;
      const chg = displayedMovement(prev && prev.close !== 0 ? (last.close - prev.close) / prev.close * 100 : null);
      const chgCls = metricValueClass(chg.text, "Change");
      sections.push(dockSection("Market pulse", "market", `<div class="mgrid">${metricCard("price", "Last price", last.close.toFixed(2), chgCls)}${metricCard("trend", "Change", chg.text, chgCls)}${metricCard("volume", "Volume", last.vol ? (last.vol > 1e8 ? (last.vol/1e8).toFixed(1)+"亿" : (last.vol/1e4).toFixed(1)+"万") : "-")}${metricCard("candles", "Candles", String(k0.rows.length))}</div>`));
    }
  }

  // ── Risk metrics ──
  if (ctx.metrics.length > 0) {
    sections.push(dockSection("Risk metrics", "risk", `<div class="mgrid">${ctx.metrics.map((c) => {
      const cls = metricValueClass(c.value, c.label);
      return metricCard("risk", esc(c.label), esc(c.value), cls);
    }).join("")}</div>`));
  }

  // ── Benchmark ──
  if (ctx.scores) {
    sections.push(dockSection("Benchmark", "benchmark", renderScoreTable(ctx.scores)));
  }

  // ── Comparison radar ──
  if (ctx.compareFactors.length >= 2) {
    sections.push(dockSection("Comparison", "compare", renderComparisonRadar(ctx.compareFactors)));
  }

  // ── Factors ──
  if (ctx.factors.length > 0) {
    sections.push(dockSection("Factor performance", "factor", renderFactorRadar(ctx.factors)));
  }

  // ── External instrument lookups, separate from archived price evidence ──
  if (sourceUrls && sourceUrls.length > 0) {
    sections.push(dockSection("Instrument lookup", "source", `<p class="source-note">External reference pages; archived observations above remain the price evidence.</p><div class="source-list">${sourceUrls.map(u =>
      `<a class="src-card" href="${esc(u.url)}" target="_blank" rel="noopener"><span class="metric-icon">${icon("source")}</span><span><b>${esc(u.label)}</b><small>${esc(u.url.replace("https://",""))}</small></span><i>↗</i></a>`
    ).join("")}</div>`));
  }

  return sections.join("\n");
}

export function elapsedStr(start: string, end: string): string {
  try {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms <= 0) return "-";
    const min = Math.round(ms / 60000);
    if (min < 1) return "<1m";
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60); const m = min % 60;
    return `${h}h ${m}m`;
  } catch { return "-"; }
}

function dockSection(title: string, kind: string, body: string): string {
  return `<section class="dock-section dock-${kind}"><div class="dock-title"><span>${icon(kind)}</span>${esc(title)}<i></i></div>${body}</section>`;
}

function metricCard(kind: string, label: string, value: string, valueClass = "nt"): string {
  return `<div class="mcard"><div class="metric-icon">${icon(kind)}</div><div class="metric-copy"><div class="ml">${label}</div><div class="mv ${valueClass}">${value}</div></div></div>`;
}

function icon(kind: string): string {
  const paths: Record<string, string> = {
    session: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/>',
    engine: '<path d="M5 5h14v14H5zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M19 9h3M2 15h3M19 15h3"/>',
    model: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
    turns: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
    tools: '<path d="m14.7 6.3 3-3a4 4 0 0 1-5 5L5 16l3 3 7.7-7.7a4 4 0 0 1 5-5l-3 3z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    market: '<path d="M3 17 8 12l4 3 8-9M16 6h4v4"/>',
    price: '<circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.6-.5-1.5-.8-2.5-.8-1.4 0-2.5.8-2.5 1.8s1 1.6 2.5 2 2.5 1 2.5 2-1.1 1.8-2.5 1.8c-1 0-2-.3-2.7-.9M12 5.5v13"/>',
    trend: '<path d="M3 18 9 12l4 3 8-9M16 6h5v5"/>',
    volume: '<path d="M5 20v-6M10 20V9M15 20V4M20 20v-9"/>',
    candles: '<path d="M6 3v18M3 8h6v7H3zM17 3v18M14 6h6v10h-6z"/>',
    risk: '<path d="M12 3 3.5 7v5c0 5 3.6 8 8.5 9 4.9-1 8.5-4 8.5-9V7zM12 8v5M12 17h.01"/>',
    benchmark: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    compare: '<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/>',
    factor: '<path d="M4 18 8 8l4 6 4-10 4 14z"/>',
    source: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
    signal: '<path d="M5 19v-2M9 19v-5M13 19v-8M17 19V8M21 19V5"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind] ?? paths.session}</svg>`;
}
