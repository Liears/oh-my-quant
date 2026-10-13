import type { Bar } from "../types/data.ts";
import type { CompletedBarSelection, DailyBarDataset, ResearchContext } from "../types/research-data.ts";

function timestampMillis(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const date = value.slice(0, 10);
  if (!validSessionDate(date) || Number(value.slice(11, 13)) > 23
    || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return NaN;
  return Date.parse(value);
}

function validSessionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function validResearchBar(bar: Bar): boolean {
  return validSessionDate(bar.date)
    && [bar.open, bar.high, bar.low, bar.close].every((v) => Number.isFinite(v) && v > 0)
    && [bar.volume, bar.amount].every((v) => Number.isFinite(v) && v >= 0)
    && bar.high >= Math.max(bar.open, bar.close, bar.low)
    && bar.low <= Math.min(bar.open, bar.close);
}

/** Select only source-confirmed daily bars known at the decision timestamp. */
export function selectCompletedBars(dataset: DailyBarDataset, context: ResearchContext): CompletedBarSelection {
  const result: CompletedBarSelection = { status: "data_insufficient", bars: [], excluded: [], issues: [] };
  const cutoff = timestampMillis(context.asOf);
  const today = context.asOf.slice(0, 10);
  const calendar = context.calendar;
  const sessions = calendar.sessions;
  if (dataset.market !== "A") result.issues.push("unsupported_research_market");
  const evidenceKnown = (e: { source: string; verifiedAt: string }) =>
    Boolean(e.source.trim()) && Number.isFinite(timestampMillis(e.verifiedAt)) && timestampMillis(e.verifiedAt) <= cutoff;
  if (!context.asOf.endsWith("+08:00") || !Number.isFinite(cutoff)) result.issues.push("invalid_analysis_timestamp");
  if (!evidenceKnown(calendar) || sessions.length === 0
    || sessions.some((s, i) => !validSessionDate(s) || s > today || (i > 0 && s <= sessions[i - 1]))
    || sessions.at(-1) !== calendar.lastCompletedSession
    || timestampMillis(calendar.verifiedAt) < Date.parse(`${calendar.lastCompletedSession}T15:00:00+08:00`)
    || (calendar.lastCompletedSession === today && context.asOf.slice(11, 19) < "15:00:00")) {
    result.issues.push("invalid_completed_exchange_calendar");
  }
  if (!dataset.symbol.trim() || !dataset.source.trim()
    || !Number.isFinite(timestampMillis(dataset.fetchedAt)) || timestampMillis(dataset.fetchedAt) > cutoff) {
    result.issues.push("invalid_dataset_provenance");
  }
  if (dataset.marketAt !== null && (!Number.isFinite(timestampMillis(dataset.marketAt))
    || timestampMillis(dataset.marketAt) > timestampMillis(dataset.fetchedAt))) {
    result.issues.push("invalid_underlying_market_timestamp");
  }
  if (!["raw", "qfq", "hfq"].includes(dataset.adjustment.basis) || !evidenceKnown(dataset.adjustment)
    || timestampMillis(dataset.adjustment.verifiedAt) > timestampMillis(dataset.fetchedAt)) {
    result.issues.push("unverified_adjustment_basis");
  }
  if (dataset.bars.some((bar, i) => i > 0 && bar.date <= dataset.bars[i - 1].date)) {
    result.issues.push("bars_not_unique_and_ascending");
  }
  // Calendar/provenance failures cannot be rescued by a partial numerical result.
  if (result.issues.length > 0) return result;
  const sessionSet = new Set(sessions);
  for (const bar of dataset.bars) {
    const ev = dataset.finality[bar.date];
    let reason: string | null = null;
    if (!validResearchBar(bar)) reason = "invalid_ohlcv";
    else if (bar.date > calendar.lastCompletedSession) reason = "not_completed_session";
    else if (!sessionSet.has(bar.date)) reason = "outside_verified_calendar";
    else if (!ev || ev.status !== "final" || !evidenceKnown(ev)
      || timestampMillis(ev.verifiedAt) > timestampMillis(dataset.fetchedAt)
      || timestampMillis(ev.verifiedAt) < Date.parse(`${bar.date}T15:00:00+08:00`)) reason = "unverified_bar_finality";
    if (reason) result.excluded.push({ date: bar.date, reason });
    else result.bars.push(bar);
  }
  if (result.bars.at(-1)?.date !== calendar.lastCompletedSession) result.issues.push("missing_latest_completed_bar");
  if (dataset.marketAt !== null && result.bars.length
    && timestampMillis(dataset.marketAt) < Date.parse(`${result.bars.at(-1)!.date}T15:00:00+08:00`)) {
    result.issues.push("market_timestamp_precedes_final_bar");
  }
  if (result.bars.length === 0) result.issues.push("no_verified_completed_bars");
  result.status = result.issues.length ? "data_insufficient" : "ready";
  return result;
}
