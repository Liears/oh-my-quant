import { expect, it } from "bun:test";
import { auditBreadthReport } from "../breadth-report-audit.ts";

function receipt() {
  const scores = { breadth_level_trend: 70, ma_crossover: 35, cycle_position: 40,
    bearish_signal: 85, historical_percentile: 30, divergence: 54 };
  const weights = { breadth_level_trend: 0.25, ma_crossover: 0.2, cycle_position: 0.2,
    bearish_signal: 0.15, historical_percentile: 0.1, divergence: 0.1 };
  const date = "2026-09-14";
  return { metadata: { total_rows: 2510, data_freshness: { latest_date: date, is_fresh: true, days_old: 2 } },
    components: Object.fromEntries(Object.entries(scores).map(([key, score]) => [key, { score, data_available: true, date }])),
    composite: { composite_score: 53.6, zone: "Neutral", data_quality: { available_count: 6, total_components: 6 },
      strongest_health: { component: "bearish_signal" }, weakest_health: { component: "historical_percentile" },
      component_scores: Object.fromEntries(Object.entries(scores).map(([key, score]) => [key,
        { score, data_available: true, weight: weights[key as keyof typeof weights], effective_weight: weights[key as keyof typeof weights] }])) },
    trend_summary: { entries: [{ data_date: date, composite_score: 53.6 }] } };
}

it("recomputes the six weighted scores and checks the source date and history receipt", () => {
  expect(auditBreadthReport(receipt(), { detailRows: 2510, latestDate: "2026-09-14" })).toEqual([]);
  const bad = receipt(); bad.composite.composite_score = 68.1; bad.composite.zone = "Healthy";
  expect(auditBreadthReport(bad, { detailRows: 2510, latestDate: "2026-09-14" })).toContain("wrong-composite-arithmetic");
  const near = receipt(); near.composite.composite_score = 53.7;
  expect(auditBreadthReport(near, { detailRows: 2510, latestDate: "2026-09-14" })).toContain("wrong-composite-arithmetic");
  expect(auditBreadthReport(receipt(), { detailRows: 2509, latestDate: "2026-09-13" })).toContain("wrong-input-date-or-freshness");
});

it("rejects a usable score when every component is missing, and catches forged weights", () => {
  const bad = receipt();
  for (const item of Object.values(bad.components)) item.data_available = false;
  for (const item of Object.values(bad.composite.component_scores)) item.data_available = false;
  bad.composite.data_quality.available_count = 0;
  expect(auditBreadthReport(bad, { detailRows: 2510, latestDate: "2026-09-14" })).toContain("no-usable-components");
  const wrong = receipt(); wrong.composite.component_scores.ma_crossover.effective_weight = 0.4;
  expect(auditBreadthReport(wrong, { detailRows: 2510, latestDate: "2026-09-14" })).toContain("wrong-effective-weight-ma_crossover");
});
