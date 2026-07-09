import { Buffer, strWidth, truncate } from "./buffer.ts";
import { S, HEADER_H, COMPOSER_H, STATUS_H, DIVIDER_CHAR, UI_DENSITY, GOLD_HIGHLIGHT, GOLD, CASH_DARK, CASH_WARM, STEP_DIM } from "./styles.ts";
import { mixHex } from "./theme.ts";
import type { ComposerSuggestion } from "./input.ts";
import type { AppState } from "./types.ts";

const STEPS = "▁▃▅▇█";

function stepColor(activity: string, i: number, n: number): string {
  if (activity === "ready") {
    const t = n > 0 ? i / n : 0;
    return mixHex(CASH_DARK, GOLD, t);
  }
  const speed = activity === "starting" ? 500 : activity === "thinking" || activity === "compacting" ? 300 : 200;
  const pos = Math.floor(Date.now() / speed) % (n * 2);
  const wave = pos < n ? pos : n * 2 - pos;
  if (i === wave) return GOLD;
  if (i === wave - 1 || i === wave + 1) return CASH_WARM;
  return STEP_DIM;
}

export function drawHeader(buf: Buffer, st: AppState): void {
  const C = buf.w;
  const n = STEPS.length - 1;
  for (let i = 0; i < STEPS.length; i++) {
    buf.set(2 + i, 0, STEPS[i], { fg: stepColor(st.activity, i, n) });
  }
  const logoX = 2 + STEPS.length + 1;
  buf.text(logoX, 0, "WhyJ Quant", UI_DENSITY === "compact" ? S.cream : S.creamB);
  if (UI_DENSITY === "compact") {
    buf.text(logoX + 11, 0, `v${st.version}`, S.dim);
    buf.hline(0, 1, C, DIVIDER_CHAR, S.rule);
    return;
  }
  buf.text(2 + STEPS.length + 2, 1, `v${st.version}`, S.dim);
  buf.hline(0, 2, C, DIVIDER_CHAR, S.rule);
}

export function drawComposer(
  buf: Buffer,
  r: { x: number; y: number; w: number; h: number },
  st: AppState,
  input: string,
  suggestions: ComposerSuggestion[] = [],
  selectedIdx: number = -1,
  _conversation?: { x: number; w: number },
): void {
  const isCmd = input.startsWith("/");
  const queue = st.composerQueue ?? [];
  const queueCount = queue.length;
  const inner = buf.box(r, {
    title: "⌘ Composer",
    titleStyle: S.muted,
    titleRight: isCmd
      ? "↑↓ select · ↹ accept"
      : queueCount > 0
        ? `${queueCount} queued · ↵ send · / commands`
        : "Shift+drag copy · / commands · ↵ send",
    titleRightStyle: S.code,
    border: S.rule,
  });

  let row = inner.y;
  if (st.composerStatus) {
    const prefix = st.composerStatus.kind === "error" ? "ERR " : "";
    const style = st.composerStatus.kind === "error" ? S.goldB : S.cream;
    buf.text(inner.x, row, truncate(prefix + st.composerStatus.text.replace(/\s+/g, " "), inner.w), style);
    row++;
  }

  const inputRow = row;
  if (input) {
    if (isCmd) {
      buf.text(inner.x, inputRow, "/", S.goldB);
      buf.text(inner.x + 1, inputRow, input.slice(1), S.gold);
      buf.text(inner.x + 1 + strWidth(input.slice(1)), inputRow, "▏", S.gold);
    } else {
      buf.text(inner.x, inputRow, "›", S.gold);
      buf.text(inner.x + 2, inputRow, input, S.cream);
      buf.text(inner.x + 2 + strWidth(input), inputRow, "▏", S.cream);
    }
  } else {
    buf.text(inner.x, inputRow, "›", S.gold);
    const hint = "write a task, or just ask a question…";
    buf.text(inner.x + 2, inputRow, truncate(`${hint}▏`, inner.w - 2), S.dim);
  }
  row++;

  const remainingRows = Math.max(0, inner.y + inner.h - row);
  if (suggestions.length > 0) {
    const visibleRows = Math.min(suggestions.length, remainingRows, 8);
    if (visibleRows >= 1) {
      const start = Math.max(0, Math.min(selectedIdx - Math.floor(visibleRows / 2), suggestions.length - visibleRows));
      const visible = suggestions.slice(start, start + visibleRows);
      for (let i = 0; i < visible.length; i++) {
        const globalIdx = start + i;
        const active = globalIdx === selectedIdx;
        const item = visible[i];
        const prefix = active ? "> " : "  ";
        const style = active ? { fg: GOLD_HIGHLIGHT, bold: true } : S.dim;
        buf.text(inner.x, row + i, truncate(`${prefix}${item.label}`, inner.w), style);
      }
      const overflow = suggestions.length - visibleRows;
      if (overflow > 0 && row + visibleRows < inner.y + inner.h) {
        buf.text(inner.x, row + visibleRows, truncate(`  … ${overflow} more`, inner.w), S.dim);
      }
      return;
    }
  }

  const showQueueRows = Math.min(queueCount, remainingRows);
  const queueOverflow = queueCount - showQueueRows;
  for (let i = 0; i < showQueueRows; i++) {
    const item = queue[i];
    const prefix = `[${i + 1}] `;
    buf.text(inner.x, row, truncate(`${prefix}${item}`, inner.w), i === 0 ? S.cream : S.dim);
    row++;
  }
  if (queueOverflow > 0 && row < inner.y + inner.h) {
    buf.text(inner.x, row, truncate(`… +${queueOverflow} more`, inner.w), S.dim);
  }
}

function formatLatency(value: number | null, perToken = false): string {
  if (value === null || !Number.isFinite(value)) return "-";
  if (value < 1_000) return perToken ? `${Math.round(value)}ms/t` : `${Math.round(value)}ms`;
  const seconds = value / 1_000;
  return perToken ? `${seconds.toFixed(2)}s/t` : `${seconds.toFixed(2)}s`;
}

function formatCompactCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return `${Math.round(value)}`;
}

function formatContextUsage(usage: { tokens: number; contextWindow: number } | null | undefined): string {
  if (!usage) return "-";
  return `${formatCompactCount(usage.tokens)}/${formatCompactCount(usage.contextWindow)}`;
}


function progressBar(percent: number | null, width: number = 5): string {
  if (percent === null || !Number.isFinite(percent)) return "░".repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round(percent / 100 * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function contextPressureLevel(percent: number | null): number {
  if (percent === null || !Number.isFinite(percent)) return 0;
  if (percent >= 85) return 3;
  if (percent >= 65) return 2;
  if (percent >= 40) return 1;
  return 0;
}

function turnPressureLevel(turns: number | null): number {
  if (turns === null || !Number.isFinite(turns) || turns <= 0) return 0;
  if (turns >= 40) return 3;
  if (turns >= 20) return 2;
  if (turns >= 10) return 1;
  return 0;
}

function sessionPressureLevel(turns: number | null, contextPct: number | null): number {
  return Math.max(turnPressureLevel(turns), contextPressureLevel(contextPct));
}

function pressureStyle(level: number, lowStyle: typeof S[keyof typeof S], idleStyle: typeof S[keyof typeof S]) {
  if (level >= 3) return S.negative;
  if (level >= 2) return S.gold;
  if (level >= 1) return lowStyle;
  return idleStyle;
}

function contextStyle(percent: number | null, turns: number | null) {
  if (percent === null || !Number.isFinite(percent)) return S.muted;
  return pressureStyle(sessionPressureLevel(turns, percent), S.cream, S.cream);
}

function ttftPressureLevel(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  if (value > 3_000) return 3;
  if (value >= 1_500) return 2;
  if (value >= 800) return 1;
  return 0;
}

function ttftStyle(value: number | null, turns: number | null, contextPct: number | null) {
  if (value === null || !Number.isFinite(value)) return S.muted;
  return pressureStyle(Math.max(ttftPressureLevel(value), sessionPressureLevel(turns, contextPct)), S.cream, S.positive);
}

function tpotPressureLevel(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  if (value > 150) return 3;
  if (value >= 80) return 2;
  if (value >= 40) return 1;
  return 0;
}

function tpotStyle(value: number | null, turns: number | null, contextPct: number | null) {
  if (value === null || !Number.isFinite(value)) return S.muted;
  return pressureStyle(Math.max(tpotPressureLevel(value), sessionPressureLevel(turns, contextPct)), S.cream, S.positive);
}

function turnStyle(turns: number | null, contextPct: number | null) {
  if (turns === null || !Number.isFinite(turns) || turns <= 0) return S.muted;
  return pressureStyle(sessionPressureLevel(turns, contextPct), S.cream, S.code);
}

type StatusSegment = { text: string; style: Parameters<Buffer["text"]>[3] };

function buildStatusSegments(st: AppState): StatusSegment[] {
  const contextPct = st.hud?.contextUsage?.percent ?? null;
  const rawTurns = st.hud?.turnCount;
  const turns = typeof rawTurns === "number" && Number.isFinite(rawTurns) && rawTurns > 0 ? rawTurns : null;
  const segments: StatusSegment[] = [
    { text: `◆ ${st.model}`, style: S.gold },
    { text: "·", style: S.dim },
    { text: "Ctx ", style: S.dim },
    { text: progressBar(contextPct), style: contextStyle(contextPct, turns) },
    { text: ` ${formatContextUsage(st.hud?.contextUsage ?? null)}`, style: contextStyle(contextPct, turns) },
    { text: "·", style: S.dim },
    { text: "TTFT ", style: S.dim },
    { text: formatLatency(st.hud?.ttftMs ?? null), style: ttftStyle(st.hud?.ttftMs ?? null, turns, contextPct) },
    { text: "·", style: S.dim },
    { text: "TPOT ", style: S.dim },
    { text: formatLatency(st.hud?.tpotMs ?? null, true), style: tpotStyle(st.hud?.tpotMs ?? null, turns, contextPct) },
    { text: "·", style: S.dim },
    { text: "T ", style: S.dim },
    { text: turns === null ? "-" : `${turns}`, style: turnStyle(turns, contextPct) },
  ];
  if (st.source) {
    segments.push({ text: "·", style: S.dim }, { text: st.source, style: S.dim });
  }
  if (st.activePortfolio) {
    segments.push({ text: "·", style: S.dim }, { text: st.activePortfolio, style: S.dim });
  }
  return segments;
}

function drawStatusSegments(buf: Buffer, row: number, width: number, segments: StatusSegment[]): void {
  let x = 0;
  for (const segment of segments) {
    if (x >= width) break;
    const remaining = width - x;
    const text = strWidth(segment.text) > remaining ? truncate(segment.text, remaining) : segment.text;
    x = buf.text(x, row, text, segment.style, remaining, width);
  }
}

export function drawStatus(buf: Buffer, row: number, width: number, st: AppState): void {
  drawStatusSegments(buf, row, width, buildStatusSegments(st));
}

export { HEADER_H, COMPOSER_H, STATUS_H };





