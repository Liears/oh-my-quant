import { collectResults } from "../quant/index.ts";

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Nested dashboard inputs use stable scan indexes, never private filenames or labels. */
export function researchReferences(name: string, details: Record<string, unknown>): Array<[string, unknown]> {
  const refs: Array<[string, unknown]> = [];
  if (details.dataset) refs.push(["input", details.dataset]);
  if (name === "alpha_backtest" || name === "alpha_runs") {
    const ref = record(record(details.result)?.request)?.dataset;
    if (ref) refs.push(["input", ref]);
  }
  refs.push(...Object.entries(record(details.datasets) ?? {}));
  if (name === "show_dashboard" && Array.isArray(details.snapshots)) {
    details.snapshots.forEach((snapshot, index) => {
      const result = record(record(snapshot)?.result);
      if (!result || collectResults([result]).length === 0) return;
      for (const [role, ref] of Object.entries(record(result.datasets) ?? {})) refs.push([`result-${index}-${role}`, ref]);
    });
  }
  if (name === "compare_portfolios" || name === "portfolio_comparisons") {
    const prices = record(record(details.result)?.input)?.prices;
    if (Array.isArray(prices)) prices.forEach((price, index) => {
      const ref = record(price)?.dataset;
      if (ref) refs.push([`price-${index}`, ref]);
    });
  }
  return refs;
}
