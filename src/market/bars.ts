import type { Bar } from "../types/data.ts";

export function isDailyDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function validateDateRange(start?: string, end?: string): void {
  if ((start !== undefined && !isDailyDate(start)) || (end !== undefined && !isDailyDate(end))) {
    throw new Error("Dates must be valid YYYY-MM-DD values.");
  }
  if (start && end && start > end) throw new Error("Start date must be on or before end date.");
}

/** One sorted daily series; later observations replace earlier corrections. */
export function normalizeBarSeries(bars: unknown, start?: string, end?: string): Bar[] {
  if (!Array.isArray(bars)) return [];
  const byDate = new Map<string, Bar>();
  for (const raw of bars) {
    if (!raw || typeof raw !== "object") continue;
    const text = String(raw.date ?? "").trim();
    const date = /^\d{8}$/.test(text)
      ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text.slice(0, 10);
    if (!isDailyDate(date) || (start && date < start) || (end && date > end)) continue;
    const fields = [raw.open, raw.high, raw.low, raw.close, raw.volume];
    if (fields.some(value => value == null || value === "" || !Number.isFinite(Number(value)))) continue;
    const [open, high, low, close, volume] = fields.map(Number);
    const amount = raw.amount == null || raw.amount === "" ? null : Number(raw.amount);
    if ((amount !== null && (!Number.isFinite(amount) || amount < 0))
      || Math.min(open!, high!, low!, close!) <= 0 || volume! < 0
      || low! > high! || open! < low! || open! > high! || close! < low! || close! > high!) continue;
    const bar: Bar = { date, open: open!, high: high!, low: low!, close: close!, volume: volume!, amount };
    if (raw.adjClose != null && Number.isFinite(Number(raw.adjClose)) && Number(raw.adjClose) > 0) {
      bar.adjClose = Number(raw.adjClose);
    }
    byDate.set(date, bar);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
