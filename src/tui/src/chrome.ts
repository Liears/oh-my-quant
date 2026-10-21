import { Buffer, charWidth, strWidth, truncate } from "./buffer.ts";
import { S, HEADER_H, COMPOSER_H, STATUS_H, DIVIDER_CHAR, UI_DENSITY, GOLD_HIGHLIGHT, GOLD, CASH_DARK, CASH_WARM, STEP_DIM } from "./styles.ts";
import { mixHex } from "./theme.ts";
import type { ComposerSuggestion } from "./input.ts";
import type { AppState } from "../../types/ui.ts";

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
    titleRight: st.activity === "thinking" || st.activity === "running tool"
      ? `${st.activity === "running tool" ? "工具" : "推理"}${st.researchStartedAt ? ` ${Math.max(0, Math.floor((Date.now() - st.researchStartedAt) / 1000))}s` : ""}${st.researchInterruptKey ? ` · ${st.researchInterruptKey} 停止` : ""} · ↵ 排队`
      : isCmd
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
    const inset = isCmd ? 0 : 2;
    const width = Math.max(1, inner.w - inset);
    const lines: string[] = [];
    let line = "", cells = 0;
    const displayInput = input.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
    for (const ch of displayInput + "▏") {
      if (ch === "\n") { lines.push(line); line = ""; cells = 0; continue; }
      const size = charWidth(ch);
      if (cells + size > width && line) { lines.push(line); line = ""; cells = 0; }
      line += ch;
      cells += size;
    }
    lines.push(line);
    const available = Math.max(0, inner.y + inner.h - row);
    if (!available) return;
    // Keep the insertion point visible while a long paste scrolls inside Composer.
    const visible = lines.slice(-available);
    if (!isCmd) buf.text(inner.x, row, lines.length > available ? "…" : "›", S.gold);
    for (const text of visible) buf.text(inner.x + inset, row++, text, isCmd ? S.gold : S.cream, width);
    if (isCmd && lines.length <= available) buf.text(inner.x, inputRow, "/", S.goldB);
  } else {
    buf.text(inner.x, inputRow, "›", S.gold);
    const hint = "输入研究问题 · /config 配置 · /artifact 报告";
    buf.text(inner.x + 2, inputRow, truncate(`${hint}▏`, inner.w - 2), S.dim);
    row++;
  }

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

export function drawStatus(buf: Buffer, row: number, width: number, st: AppState): void {
  width = Math.min(width, buf.w);
  if (width <= 0) return;
  const modelLimit = Math.min(width, Math.max(12, Math.floor(width * 0.45)));
  let x = buf.text(0, row, truncate(st.model, modelLimit), S.muted, width, width);
  const displayedPortfolio = st.panel.find(section => section.kind === "group" || section.kind === "holdings")?.title ?? st.activePortfolio;
  for (const value of [st.source, displayedPortfolio]) {
    if (!value) continue;
    const text = `${x > 0 ? " · " : ""}${value}`;
    if (strWidth(text) > width - x) continue;
    x = buf.text(x, row, text, S.muted, width - x, width);
  }
}

export { HEADER_H, COMPOSER_H, STATUS_H };





