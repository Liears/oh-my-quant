export interface HudContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number | null;
}

export interface HudMetrics {
  contextUsage: HudContextUsage | null;
  turnCount: number;
  /** Session-average TTFT across completed assistant turns with visible output. */
  ttftMs: number | null;
  /** Session-average TPOT across completed assistant turns with token usage. */
  tpotMs: number | null;
}
