/** Independent receipt check for the reviewed public breadth script; no trading recommendation is inferred. */
const WEIGHTS = {
  breadth_level_trend: 0.25,
  ma_crossover: 0.20,
  cycle_position: 0.20,
  bearish_signal: 0.15,
  historical_percentile: 0.10,
  divergence: 0.10,
} as const;
type Component = keyof typeof WEIGHTS;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function zone(score: number): string {
  return score >= 80 ? "Strong" : score >= 60 ? "Healthy" : score >= 40 ? "Neutral" : score >= 20 ? "Weakening" : "Critical";
}

function oneDecimalHalfEven(value: number): number {
  const scaled = value * 10, lower = Math.floor(scaled), fraction = scaled - lower;
  return (Math.abs(fraction - 0.5) < 1e-8 ? lower + (lower % 2) : Math.round(scaled)) / 10;
}

/** Cross-check source identity and score arithmetic from the full script output. */
export function auditBreadthReport(raw: unknown, input: { detailRows: number; latestDate: string }): string[] {
  const issues: string[] = [], report = object(raw), metadata = object(report?.metadata), composite = object(report?.composite);
  const components = object(report?.components), scored = object(composite?.component_scores);
  if (!report || !metadata || !composite || !components || !scored) return ["incomplete-report"];
  const freshness = object(metadata.data_freshness);
  if (metadata.total_rows !== input.detailRows || freshness?.latest_date !== input.latestDate
    || freshness?.is_fresh !== true || typeof freshness.days_old !== "number"
    || !Number.isInteger(freshness.days_old) || freshness.days_old < 0 || freshness.days_old > 5)
    issues.push("wrong-input-date-or-freshness");
  const available: Array<{ key: Component; score: number }> = [];
  for (const key of Object.keys(WEIGHTS) as Component[]) {
    const item = object(components[key]), row = object(scored[key]);
    if (!item || !row || item.date !== input.latestDate || typeof item.score !== "number"
      || !Number.isFinite(item.score) || item.score < 0 || item.score > 100 || typeof item.data_available !== "boolean"
      || row.score !== item.score || row.data_available !== item.data_available || row.weight !== WEIGHTS[key]) {
      issues.push(`invalid-component-${key}`);
      continue;
    }
    if (item.data_available) available.push({ key, score: item.score });
  }
  if (!available.length) issues.push("no-usable-components");
  const availableWeight = available.reduce((sum, item) => sum + WEIGHTS[item.key], 0);
  const expected = availableWeight > 0 ? available.reduce((sum, item) => sum + item.score * WEIGHTS[item.key], 0) / availableWeight : NaN;
  const reported = composite.composite_score;
  if (typeof reported !== "number" || !Number.isFinite(reported) || reported < 0 || reported > 100
    || Number.isFinite(expected) && Math.abs(reported - oneDecimalHalfEven(expected)) > 1e-8) issues.push("wrong-composite-arithmetic");
  if (typeof reported === "number" && Number.isFinite(reported) && composite.zone !== zone(reported)) issues.push("wrong-health-zone");
  const quality = object(composite.data_quality);
  if (quality?.available_count !== available.length || quality?.total_components !== 6) issues.push("wrong-data-quality");
  for (const { key } of available) {
    const row = object(scored[key])!;
    if (typeof row.effective_weight !== "number" || Math.abs(row.effective_weight - WEIGHTS[key] / availableWeight) > 0.000001)
      issues.push(`wrong-effective-weight-${key}`);
  }
  if (available.length) {
    const strongest = available.reduce((best, item) => item.score > best.score ? item : best);
    const weakest = available.reduce((best, item) => item.score < best.score ? item : best);
    if (object(composite.strongest_health)?.component !== strongest.key || object(composite.weakest_health)?.component !== weakest.key)
      issues.push("wrong-strongest-or-weakest");
  }
  const history = object(report.trend_summary), entries = Array.isArray(history?.entries) ? history.entries : [];
  const latest = object(entries.at(-1));
  if (!latest || latest.data_date !== input.latestDate || latest.composite_score !== reported) issues.push("wrong-history-entry");
  return issues;
}
