import type { Bar } from "../../types/data.ts";

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

export function formatBarsChartBlock(bars: Bar[]): string[] {
  if (bars.length === 0) return [];
  return [
    formatCloseSparkline(bars),
    formatVolumeSparkline(bars),
    ...formatKLineRows(bars),
  ];
}

function formatCloseSparkline(bars: Bar[], count = 24): string {
  const sample = bars.slice(-count);
  const closes = sample.map((bar) => bar.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min;
  const spark = closes.map((close) => {
    const idx = span === 0 ? Math.floor(SPARK_CHARS.length / 2) : Math.round((close - min) / span * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, idx))];
  }).join("");
  const latest = sample[sample.length - 1];
  const previous = sample[sample.length - 2];
  const change = previous && previous.close !== 0 ? (latest.close - previous.close) / previous.close * 100 : 0;
  return `⌁ Close     ${spark}  ${latest.close.toFixed(2)}  ${formatSignedPct(change)}`;
}

function formatVolumeSparkline(bars: Bar[], count = 24): string {
  const sample = bars.slice(-count);
  const volumes = sample.map((bar) => bar.volume);
  const min = Math.min(...volumes);
  const max = Math.max(...volumes);
  const span = max - min;
  const spark = volumes.map((volume) => {
    const idx = span === 0 ? Math.floor(SPARK_CHARS.length / 2) : Math.round((volume - min) / span * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, idx))];
  }).join("");
  const latest = sample[sample.length - 1];
  return `▥ Volume    ${spark}  ${formatCompactNumber(latest.volume)}`;
}

function formatKLineRows(bars: Bar[], count = 3): string[] {
  const start = Math.max(0, bars.length - count);
  const rows = ["┃ K-line"];
  for (let i = start; i < bars.length; i++) {
    const bar = bars[i]!;
    const previous = bars[i - 1];
    const direction = bar.close > bar.open ? "▲" : bar.close < bar.open ? "▼" : "─";
    const base = previous?.close || bar.open;
    const change = base !== 0 ? (bar.close - base) / base * 100 : 0;
    rows.push(
      `${bar.date}  ${direction}  O=${bar.open.toFixed(2)} H=${bar.high.toFixed(2)} L=${bar.low.toFixed(2)} C=${bar.close.toFixed(2)}  ${formatSignedPct(change)}`,
    );
  }
  return rows;
}

function formatSignedPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(0);
}
