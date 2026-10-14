import type { ResearchMetric } from "./types.ts";

/** Model-facing units describe the stored value; display already includes percentage scaling. */
export function researchMetricsForModel(metrics: ResearchMetric[]) {
  return metrics.map(metric => ({ ...metric,
    unit: metric.unit === "percent" ? "fraction" : metric.unit,
    display: metric.value === null ? "N/A" : metric.unit === "percent"
      ? `${Number((metric.value * 100).toPrecision(8))}%`
      : `${metric.value}${metric.unit === "periods" ? " periods" : ""}`,
  }));
}
