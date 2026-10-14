/**
 * Session JSONL -> Dual-column artifact generator.
 *
 * Dashboard (left): conversation timeline, structured data detection,
 *   K-line charts, metric cards, score tables, factor performance.
 * Trajectory (right tab): structured agent execution trace with
 *   Compact/Audit/Raw view modes (per docs/quant-harness/artifacts-design.md).
 *
 * Detection: paragraph-level (split by \n\n), first match wins:
 *   K-line (OHLC) > Compare factors > Factor bars > Metrics > Score table > Data table > Plain text
 */

import { loadReportSession, renderReportEvidence } from "./report-input.ts";
import { buildResearchReport } from "../../research/input.ts";
import { renderResearchResults, renderShareReport } from "./research-renderer.ts";
import { esc, renderArtifactTemplate, type ArtifactTemplateInput } from "./template.ts";
import { readWhyjEnvValue } from "../../storage/src/env-keys.ts";
import type { GenerateArtifactInput, GenerateArtifactResult, GenCtx, RawEntry, ContentBlock } from "./types.ts";
import { extractText } from "./message-text.ts";
import { tryKline, tryNavChart, tryMetrics, tryScoreTable, tryDataTable, tryFactorBars, tryCompareFactors, renderDataTable } from "./detectors.ts";
import { renderEchartsBars, renderFactorMatrix, renderMetricCards, renderScoreTable, highlight } from "./renderers.ts";
import { renderDock } from "./dock.ts";
import { buildTrajectoryFromSession } from "./trajectory.ts";
import { renderTrajectoryDocument } from "./trajectory-renderer.ts";
import { renderDashboardOverview } from "./dashboard.ts";
import { instrumentLookupUrls } from "./source-links.ts";
import {
  metrics as computeRiskMetrics, annualReturn as computeAnnualReturn, calendarYears, sharpe as computeSharpe,
  momentum, rsi, smaDeviation, volatility,
  volumeRatio,
} from "../../quant/index.ts";

export { extractText } from "./message-text.ts";
export type { GenerateArtifactInput, GenerateArtifactResult } from "./types.ts";

function resolveQuantModel(): string {
  return readWhyjEnvValue(process.env as Record<string, string | undefined>, "model") || "whyj-quant";
}

export function generateArtifact(input: GenerateArtifactInput): GenerateArtifactResult | null {
  const raw = loadReportSession(input.sessionPath, input.leafId);
  if (!raw) return null;
  const entries = raw.lines;
  const messageCount = entries.filter((e) => e.type === "message").length;

  const ctx = createGenCtx(entries);
  const quantModel = resolveQuantModel();

  // Build structured trajectory from session entries
  const trajDoc = buildTrajectoryFromSession(
    entries,
    String(raw.header.id ?? "unknown"),
    `run_${Date.now()}`,
  );

  const evidenceHtml = renderReportEvidence(raw, input.resolveDataset, input.resolveFundDataset);
  const research = buildResearchReport(raw, input.resolveDataset, input.resolveFundDataset, input.resolveComparison);
  const sourceUrls = instrumentLookupUrls(research.datasets);
  const hasTextData = ctx.klines.length || ctx.navCharts.length || ctx.metrics.length || ctx.factors.length || ctx.compareFactors.length || ctx.scores;
  const textDashboard = !evidenceHtml || hasTextData
    ? (evidenceHtml ? "<div class=\"board-head\"><div><h2>Session interpretation</h2><p>Values below were extracted from session text. Their interpretation is separate from the archived price observations above.</p></div></div>" : "") + renderDashboardOverview(ctx)
    : "";

  const templateInput: ArtifactTemplateInput = {
    marketColorScheme: input.marketColorScheme,
    title: input.title || ctx.title,
    sessionId: String(raw.header.id ?? "unknown"),
    model: ctx.model,
    quantModel,
    messageCount,
    createdAt: String(raw.header.timestamp ?? new Date().toISOString()),
    dashboardHtml: renderResearchResults(research) + evidenceHtml + textDashboard,
    bodyHtml: ctx.dashBody.join("\n"),
    dockHtml: renderDock(ctx, quantModel, sourceUrls),
    trajectoryHtml: renderTrajectoryDocument(trajDoc),
    generatedAt: new Date().toISOString(),
    shareHtml: renderShareReport(research),
  };

  return {
    html: renderArtifactTemplate(templateInput),
    title: templateInput.title,
    sessionId: templateInput.sessionId,
    messageCount,
    provenance: raw.provenance,
  };
}

// ── Context building ──

function createGenCtx(entries: RawEntry[]): GenCtx {
  const ctx: GenCtx = {
    title: "Untitled", dashBody: [], trajBody: [], metrics: [], scores: null, factors: [], klines: [], navCharts: [], compareFactors: [],
    stats: { turnCount: 0, toolCallCount: 0, skillNames: [], firstTs: "", lastTs: "" },
  };

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg || typeof msg.role !== "string") continue;
    const role = normalizeRole(msg.role);
    if (!role) continue;

    const ts = typeof entry.timestamp === "string" ? entry.timestamp : "";
    if (ts) {
      if (!ctx.stats.firstTs) ctx.stats.firstTs = ts;
      ctx.stats.lastTs = ts;
    }

    if (role === "assistant" && !ctx.model && typeof msg.model === "string") ctx.model = msg.model;
    if (role === "assistant") ctx.stats.turnCount++;

    renderMessage(ctx, msg, role);
  }

  enrichQuantMetrics(ctx);
  if (ctx.title === "Untitled") ctx.title = inferResearchTitle(entries);

  return ctx;
}

/** Deterministic fallback: derive dashboard metrics from persisted OHLC/NAV series. */
function enrichQuantMetrics(ctx: GenCtx): void {
  const klineRows = ctx.klines[0]?.rows;
  const navRows = ctx.navCharts[0]?.rows;
  const values = klineRows?.map((row) => row.close) ?? navRows?.map((row) => row.nav) ?? [];
  if (values.length < 3 || values.some((value) => !Number.isFinite(value) || value <= 0)) return;

  const returns = values.slice(1).map((value, index) => value / values[index]! - 1);
  const periodReturn = values[values.length - 1]! / values[0]! - 1;
  addMetric(ctx, "累计收益", formatPercent(periodReturn), periodReturn * 100);
  const dates = (klineRows ?? navRows ?? []).map(row => row.date);
  try {
    const annualReturn = computeAnnualReturn(returns, { elapsedYears: calendarYears(dates) });
    addMetric(ctx, "年化收益率", formatPercent(annualReturn), annualReturn * 100);
  } catch { /* Text tables without valid dates do not establish an annualization span. */ }
  const periodsPerYear = ({ "周K": 52, "月K": 12, "季K": 4, "年K": 1 } as Record<string, number>)[ctx.klines[0]?.timeframe ?? ""] ?? 252;
  const sharpe = computeSharpe(returns, 0.02, periodsPerYear);
  if (sharpe !== null) addMetric(ctx, "夏普比率", sharpe.toFixed(2), sharpe);

  try {
    const risk = computeRiskMetrics(returns, periodsPerYear);
    addMetric(ctx, "年化波动率", formatPercent(risk.annualVol), risk.annualVol * 100);
    addMetric(ctx, "下行波动率", formatPercent(risk.downsideVol), risk.downsideVol * 100);
    addMetric(ctx, "VaR (95%)", formatPercent(risk.var95), risk.var95 * 100);
    addMetric(ctx, "CVaR (95%)", formatPercent(risk.cvar95), risk.cvar95 * 100);
    addMetric(ctx, "最大回撤", formatPercent(risk.maxDrawdown), risk.maxDrawdown * 100);
    addMetric(ctx, "最大回撤周期", `${risk.maxDdDays} periods`, risk.maxDdDays);
    addMetric(ctx, "偏度", risk.skewness.toFixed(3), risk.skewness);
    addMetric(ctx, "超额峰度", risk.kurtosis.toFixed(3), risk.kurtosis);
  } catch { /* insufficient valid returns: keep return metrics only */ }

  if (!klineRows) return;
  const closes = klineRows.map((row) => row.close);
  const periodLabel = ({ "周K": "周", "月K": "月", "季K": "季", "年K": "年" } as Record<string, string>)[ctx.klines[0]?.timeframe ?? ""] ?? "日";
  addLatestSeriesMetric(ctx, `20${periodLabel}动量`, momentum(closes, 20), true);
  addLatestSeriesMetric(ctx, "RSI (14)", rsi(closes, 14), false);
  addLatestSeriesMetric(ctx, "SMA5/20 偏离", smaDeviation(closes, 5, 20), true);
  addLatestSeriesMetric(ctx, `20${periodLabel}实现波动`, volatility(closes, 20).map(value => value === null ? null : value * Math.sqrt(periodsPerYear / 252)), true);
  if (klineRows.every((row) => typeof row.vol === "number")) {
    addLatestSeriesMetric(ctx, `20${periodLabel}量比`, volumeRatio(klineRows.map((row) => row.vol!), 20), false);
  }
}

function addLatestSeriesMetric(ctx: GenCtx, label: string, series: Array<number | null>, percent: boolean): void {
  const value = [...series].reverse().find((item): item is number => typeof item === "number" && Number.isFinite(item));
  if (value === undefined) return;
  addMetric(ctx, label, percent ? formatPercent(value) : value.toFixed(2), percent ? value * 100 : value);
}

function addMetric(ctx: GenCtx, label: string, value: string, num: number): void {
  const key = label.toLowerCase().replace(/[\s()（）/%]/g, "");
  const exists = ctx.metrics.some((metric) => metric.label.toLowerCase().replace(/[\s()（）/%]/g, "") === key);
  if (!exists && Number.isFinite(num)) ctx.metrics.push({ label, value, num });
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

/** Derive a report identity from the researched instrument, never from generic prompt prose. */
function inferResearchTitle(entries: RawEntry[]): string {
  const texts: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg || (msg.role !== "user" && msg.role !== "displayUser" && msg.role !== "assistant")) continue;
    const display = typeof msg.displayText === "string" ? msg.displayText : "";
    const text = display || extractText(msg.content);
    if (text && !text.trimStart().startsWith("<skill")) texts.push(text);
  }

  const pairs: Array<{ name: string; code: string }> = [];
  const add = (rawName: string, rawCode: string): void => {
    const name = cleanInstrumentName(rawName);
    const code = rawCode.toUpperCase();
    if (!name || !code || pairs.some((pair) => pair.name === name && pair.code === code)) return;
    const baseCode = code.match(/\d{6}/)?.[0] || code;
    const existingIndex = pairs.findIndex((pair) => (pair.code.match(/\d{6}/)?.[0] || pair.code) === baseCode);
    if (existingIndex >= 0) {
      const existing = pairs[existingIndex]!;
      const richerCode = code.includes(".") && !existing.code.includes(".");
      if (instrumentNameScore(name) > instrumentNameScore(existing.name) || richerCode) pairs[existingIndex] = { name, code };
      return;
    }
    pairs.push({ name, code });
  };

  for (const text of texts) {
    for (const match of text.matchAll(/([A-Za-z][A-Za-z0-9 .&-]{1,28}|[一-龥][一-龥A-Za-z0-9·-]{1,20})\s*[（(]\s*((?:\d{6})(?:\.(?:SZ|SH|BJ))?|[A-Z]{1,6})\s*[)）]/g)) {
      add(match[1]!, match[2]!);
    }
    for (const match of text.matchAll(/(?:分析|研究|评估|跟踪|查看|关于)\s*([A-Za-z][A-Za-z0-9 .&-]{1,28}|[一-龥][一-龥A-Za-z0-9·-]{1,20})[\s,，:：-]+((?:\d{6})(?:\.(?:SZ|SH|BJ))?)/gi)) {
      add(match[1]!, match[2]!);
    }
    for (const match of text.matchAll(/([一-龥][一-龥A-Za-z0-9·-]{1,20})\s+((?:\d{6})(?:\.(?:SZ|SH|BJ))?)/gi)) {
      add(match[1]!, match[2]!);
    }
    if (pairs.length >= 3) break;
  }

  if (pairs.length > 0) return pairs.slice(0, 3).map((pair) => `${pair.name} (${pair.code})`).join(" vs ");

  const allText = texts.join("\n");
  const code = allText.match(/\b((?:\d{6})(?:\.(?:SZ|SH|BJ))?)\b/i)?.[1]?.toUpperCase();
  const namedMarket = allText.match(/(沪深300|中证500|中证1000|上证指数|科创50|创业板指|恒生指数|纳斯达克|标普500|固态电池|半导体|机器人|人工智能|新能源|医药|消费)/)?.[1];
  if (code && namedMarket) return `${namedMarket} (${code})`;
  if (code) return `研究对象 (${code})`;
  if (namedMarket) return `${namedMarket}量化研究`;
  return "量化研究报告";
}

function cleanInstrumentName(value: string): string {
  const name = value
    .replace(/^(?:请|帮我|麻烦|对|给我|一下|近期|关于)+/g, "")
    .replace(/^(?:分析|研究|评估|跟踪|查看)\s*/g, "")
    .replace(/(?:技术分析|走势分析|量化分析|研究报告|近期走势)$/g, "")
    .trim()
    .slice(0, 30);
  if (!name || name.length > 20) return "";
  if (/(?:拿到|现在|动量|最强|数据|结果|建议|价格|对于|我们|可以|进行|指标|相关|行业|成功|失败|返回|查询)/.test(name)) return "";
  if (/[的了把从到与和或是]/.test(name) && !/(股份|集团|联合|和谐)/.test(name)) return "";
  return name;
}

function instrumentNameScore(name: string): number {
  let score = Math.min(name.length, 12);
  if (/(?:股份|科技|电子|锂业|能源|材料|电池|矿业|控股|集团|实业|证券|银行|医药|ETF|基金|指数)$/.test(name)) score += 20;
  if (/^[A-Z][A-Z0-9 .&-]+$/i.test(name)) score += 8;
  return score;
}

// ── Message rendering ──

const SKILL_NAME_RE = /<skill\s+name\s*=\s*"([^"]+)"/;

function renderMessage(ctx: GenCtx, msg: Record<string, unknown>, role: string): void {
  const dParts: string[] = [];
  const tParts: string[] = [];
  const content = msg.content;

  if (role === "tool") {
    const text = extractText(content);
    if (text) {
      const toolName = typeof msg.toolName === "string" ? msg.toolName : "";
      const truncated = text.length > 8000 ? text.slice(0, 8000) + "\n… (truncated)" : text;
      tParts.push(`<details class="tr"><summary><span class="tr-dot"></span>${esc(toolName)}</summary><pre>${esc(truncated)}</pre></details>`);
    }
  } else if (role === "assistant" && Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === "thinking") {
        const th = String(block.thinking || "").slice(0, 3000);
        tParts.push(`<details class="th"><summary>Thinking</summary><div class="th-body">${esc(th)}</div></details>`);
      } else if (block.type === "text") {
        const text = String(block.text || "");
        if (text) {
          dParts.push(...processText(ctx, text));
          tParts.push(...trajectoryText(text));
        }
      } else if (block.type === "toolCall") {
        ctx.stats.toolCallCount++;
        const name = String(block.name || "");
        const args = formatToolArgs(block.arguments);
        const isSkill = name === "Skill" || name.includes("skill");
        let skillName = "";
        if (name === "Skill") {
          const sm = String(args).match(SKILL_NAME_RE);
          if (sm) { skillName = sm[1]!; if (!ctx.stats.skillNames.includes(skillName)) ctx.stats.skillNames.push(skillName); }
        }
        if (isSkill && skillName) {
          tParts.push(`<div class="tc skill"><span class="tc-dot"></span>Skill: <span class="tc-name">${esc(skillName)}</span></div>`);
        } else {
          const argHtml = args ? `<div class="tc-args">${esc(args)}</div>` : "";
          tParts.push(`<details class="tc"><summary><span class="tc-dot"></span>${esc(name)}</summary>${argHtml}</details>`);
        }
      }
    }
  } else {
    const text = extractText(content);
    if (text) {
      const sm = text.match(SKILL_NAME_RE);
      if (sm) {
        if (!ctx.stats.skillNames.includes(sm[1]!)) ctx.stats.skillNames.push(sm[1]!);
        tParts.push(`<div class="tc skill"><span class="tc-dot"></span>Skill: <span class="tc-name">${esc(sm[1])}</span></div>`);
      }
      let clean = text.replace(/<skill\b[\s\S]*?(?:<\/skill>|\/?>)/g, "").replace(/^[\s\S]*?<\/skill>\s*/g, "");
      const commentIdx = clean.indexOf("<!--");
      if (commentIdx > 0) clean = clean.slice(0, commentIdx);
      clean = clean.trim();
      if (clean && !clean.startsWith("<skill")) {
        dParts.push(...processText(ctx, clean));
        tParts.push(...trajectoryText(clean));
      }
    }
  }

  if (dParts.length > 0) {
    const label = role === "user" ? "User" : "WhyJ Quant";
    const cls = role === "user" ? "user" : "assistant";
    ctx.dashBody.push(`<div class="msg"><div class="msg-role ${cls}"><span class="dot"></span>${label}</div><div class="msg-body">${dParts.join("\n")}</div></div>`);
  }
  if (tParts.length > 0) {
    const label = roleLabels[role] || role;
    const cls = role === "user" ? "user" : role === "assistant" ? "assistant" : "tool";
    ctx.trajBody.push(`<div class="msg"><div class="msg-role ${cls}"><span class="dot"></span>${label}</div><div class="msg-body">${tParts.join("\n")}</div></div>`);
  }
}

const roleLabels: Record<string, string> = { user: "User", assistant: "WhyJ Quant", tool: "Tool" };

// ── Text paragraph detection ──

function processText(ctx: GenCtx, text: string): string[] {
  const parts: string[] = [];
  const paras = text.split(/\n{2,}/);
  for (const para of paras) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const navChart = tryNavChart(trimmed);
    if (navChart) {
      if (!ctx.navCharts.some((chart) => chart.rows[0]?.date === navChart.rows[0]?.date && chart.rows.length === navChart.rows.length)) {
        ctx.navCharts.push(navChart);
      }
      continue;
    }
    const klines = tryKline(trimmed);
    if (klines && klines.length > 0) {
      for (const kl of klines) {
        if (!ctx.klines.some((x) => x.timeframe === kl.timeframe)) ctx.klines.push(kl);
      }
      continue;
    }
    const comp = tryCompareFactors(trimmed);
    if (comp) {
      for (const s of comp) { if (!ctx.compareFactors.some((x) => x.name === s.name)) ctx.compareFactors.push(s); }
      continue;
    }
    const bars = tryFactorBars(trimmed);
    if (bars) {
      for (const b of bars) { if (!ctx.factors.some((x) => x.label === b.label)) ctx.factors.push(b); }
      parts.push(bars.length > 8 ? renderFactorMatrix(bars) : renderEchartsBars(bars));
      continue;
    }
    const metrics = tryMetrics(trimmed);
    if (metrics) {
      for (const m of metrics) { if (!ctx.metrics.some((x) => x.label === m.label)) ctx.metrics.push(m); }
      parts.push(renderMetricCards(metrics));
      continue;
    }
    const scores = tryScoreTable(trimmed);
    if (scores) {
      if (!ctx.scores) ctx.scores = scores;
      parts.push(renderScoreTable(scores));
      continue;
    }
    const dataTbl = tryDataTable(trimmed);
    if (dataTbl) {
      parts.push(renderDataTable(dataTbl));
      continue;
    }
    parts.push(`<p>${highlight(esc(trimmed)).replace(/\n/g, "<br>")}</p>`);
  }
  return parts;
}

// ── Trajectory text: tables -> HTML, rest -> raw ──

function trajectoryText(text: string): string[] {
  const parts: string[] = [];
  const paras = text.split(/\n{2,}/);
  for (const para of paras) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const tbl = tryDataTable(trimmed);
    if (tbl) {
      parts.push(renderDataTable(tbl));
    } else {
      parts.push(`<div class="traj-raw">${esc(trimmed).replace(/\n/g, "<br>")}</div>`);
    }
  }
  return parts;
}

// ── Helpers ──

function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const entries = Object.entries(a);
  if (entries.length === 0) return "";
  if (entries.length === 1) return String(entries[0]![1]);
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
}

export function normalizeRole(r: string): "user" | "assistant" | "tool" | null {
  if (r === "user" || r === "displayUser") return "user";
  if (r === "assistant") return "assistant";
  if (r === "toolResult") return "tool";
  return null;
}
