/** Independent arithmetic check of the pinned public macro scorer's six component receipt. */
const WEIGHTS = {
  concentration: 0.25,
  yield_curve: 0.20,
  credit_conditions: 0.15,
  size_factor: 0.15,
  equity_bond: 0.15,
  sector_rotation: 0.10,
} as const;
type Component = keyof typeof WEIGHTS;

const ETFS = ["RSP", "SPY", "IWM", "TLT", "SHY", "HYG", "LQD", "XLY", "XLP"] as const;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function oneDecimalHalfEven(value: number): number {
  const scaled = value * 10, lower = Math.floor(scaled), fraction = scaled - lower;
  return (Math.abs(fraction - 0.5) < 1e-8 ? lower + (lower % 2) : Math.round(scaled)) / 10;
}

function zone(score: number): string {
  if (score <= 20) return "Stable (No Transition)";
  if (score <= 40) return "Early Signal (Monitoring)";
  if (score <= 60) return "Transition Zone (Preparing)";
  if (score <= 80) return "Active Transition (Repositioning)";
  return "Confirmed Transition (Completing)";
}

/** Checks report consistency; raw ETF prices and financial interpretation remain separate evidence. */
export function auditMacroReport(raw: unknown): string[] {
  const issues: string[] = [], report = object(raw), metadata = object(report?.metadata), composite = object(report?.composite);
  const components = object(report?.components), scored = object(composite?.component_scores), quality = object(composite?.data_quality);
  if (!report || !metadata || !composite || !components || !scored || !quality) return ["incomplete-report"];
  const analyzed = metadata.etfs_analyzed;
  if (metadata.data_source !== "yfinance" || metadata.data_mode !== "yfinance_only"
    || !Array.isArray(analyzed) || analyzed.length !== ETFS.length
    || !ETFS.every((symbol, index) => analyzed[index] === symbol)) issues.push("wrong-public-input-mode");
  const values: Array<{ key: Component; score: number; available: boolean }> = [];
  for (const key of Object.keys(WEIGHTS) as Component[]) {
    const item = object(components[key]), row = object(scored[key]);
    if (!item || typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < 0 || item.score > 100
      || typeof item.data_available !== "boolean") {
      issues.push(`invalid-component-${key}`);
      continue;
    }
    if (!row || row.score !== item.score || row.weight !== WEIGHTS[key]
      || row.weighted_contribution !== oneDecimalHalfEven(item.score * WEIGHTS[key]))
      issues.push(`invalid-component-${key}`);
    values.push({ key, score: item.score, available: item.data_available });
  }
  if (values.length !== 6) issues.push("missing-component-scores");
  const weighted = values.reduce((sum, item) => sum + item.score * WEIGHTS[item.key], 0);
  const reported = composite.composite_score;
  if (typeof reported !== "number" || !Number.isFinite(reported) || reported < 0 || reported > 100
    || values.length === 6 && Math.abs(reported - oneDecimalHalfEven(weighted)) > 1e-8)
    issues.push("wrong-composite-arithmetic");
  if (typeof reported === "number" && Number.isFinite(reported) && composite.zone !== zone(reported))
    issues.push("wrong-transition-zone");
  if (quality.available_count !== values.filter(item => item.available).length || quality.total_components !== 6)
    issues.push("wrong-data-quality");
  if (composite.signaling_components !== values.filter(item => item.score >= 40).length)
    issues.push("wrong-signaling-count");
  const strongest = values.reduce((best, item) => !best || item.score > best.score ? item : best, undefined as typeof values[number] | undefined);
  const weakest = values.reduce((best, item) => !best || item.score < best.score ? item : best, undefined as typeof values[number] | undefined);
  if (object(composite.strongest_signal)?.component !== strongest?.key || object(composite.strongest_signal)?.score !== strongest?.score
    || object(composite.weakest_signal)?.component !== weakest?.key || object(composite.weakest_signal)?.score !== weakest?.score)
    issues.push("wrong-strongest-or-weakest");
  return issues;
}

export { auditMacroPresentation } from "./macro-presentation-audit.ts";
