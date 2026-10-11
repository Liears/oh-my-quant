/** Shared presentation semantics. Colors never decide whether a risk or command is good. */
export type MetricTone = "up" | "down" | "positive" | "negative" | "neutral";

export function movementTone(value: number | null | undefined): "up" | "down" | "neutral" {
  if (value == null || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "up" : "down";
}

/** Tone follows the displayed precision; rounded zero and unavailable values stay neutral. */
export function displayedMovement(value: number | null | undefined): { text: string; tone: "up" | "down" | "neutral" } {
  if (value == null || !Number.isFinite(value)) return { text: "N/A", tone: "neutral" };
  const rounded = Number(value.toFixed(2));
  return { text: `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`, tone: movementTone(rounded) };
}

/** Parse an entire displayed number; dates, codes with suffixes and prose are not numbers. */
export function displayedNumber(text: string): number | null {
  const clean = text.trim().replace(/^[▲△↑▼▽↓]\s*/, "").replace(/−/g, "-");
  if (!/^[+-]?(?:\d+(?:,\d{3})*(?:\.\d*)?|\.\d+)(?:%|％)?$/.test(clean)) return null;
  const value = Number(clean.replace(/[,％%]/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function metricTone(text: string, label = ""): MetricTone | undefined {
  const trimmed = text.trim();
  if (/^(?:|n\/a|na|null|undefined|nan|--?|—|无数据|缺失)$/i.test(trimmed)) return "neutral";
  if (/^(ok|ready|kept|pass|passed|healthy|valid|成功|就绪)$/i.test(trimmed)) return "positive";
  if (/^(error|failed|fail|invalid|breach|risk|失败|错误)$/i.test(trimmed)) return "negative";
  if (/^(missing|buy|sell|long|short)$/i.test(trimmed)) return "neutral";
  const value = displayedNumber(trimmed);
  if (value !== null) {
    if (value === 0) return "neutral";
    if (/(score|grade|rating|评分|得分|总分)/i.test(label)) return value < 0 ? "negative" : "positive";
    // A drawdown or loss is a risk amount, regardless of how the provider signs it.
    if (/(?:\bdd\b|drawdown|\b(?:c?var)\b|loss|breach|risk|volatility|回撤|风险|亏损|波动)/i.test(label)) return "negative";
    if (/(score|grade|sharpe|sortino|calmar|评分|夏普)/i.test(label)) return value < 0 ? "negative" : "positive";
    if (/(cagr|return|change|pct|pnl|profit|收益|涨跌|盈亏)/i.test(label) || /^[+−-]|^[▲△↑▼▽↓]/.test(trimmed)) {
      return movementTone(value);
    }
  }
  if (/^(up|上涨)$/i.test(trimmed) || /^[▲△↑]$/.test(trimmed)) return "up";
  if (/^(down|下跌)$/i.test(trimmed) || /^[▼▽↓]$/.test(trimmed)) return "down";
  return undefined;
}
