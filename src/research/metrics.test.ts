import { expect, it } from "bun:test";
import { researchMetricsForModel } from "./metrics.ts";
import { formatResearchContext, projectResearchState } from "./state.ts";
import type { ResearchMetric } from "./types.ts";

it("distinguishes fractional values from percent display without changing numerical evidence", () => {
  const metrics: ResearchMetric[] = [
    { label: "Annual volatility", value: 0.013038293078614618, unit: "percent" },
    { label: "Total return", value: -0.25, unit: "percent" },
    { label: "Maximum drawdown", value: 0, unit: "percent" },
    { label: "Sharpe", value: null, unit: "number" },
    { label: "Latest", value: 2 / 137, unit: "number" },
    { label: "Drawdown duration", value: 3, unit: "periods" },
  ];
  const before = structuredClone(metrics), result = researchMetricsForModel(metrics);
  expect(result.map(metric => metric.display)).toEqual(["1.3038293%", "-25%", "0%", "N/A", String(2 / 137), "3 periods"]);
  expect(result.map(metric => metric.unit)).toEqual(["fraction", "fraction", "fraction", "number", "number", "periods"]);
  expect(result.map(metric => metric.value)).toEqual(metrics.map(metric => metric.value));
  expect(metrics).toEqual(before);
});

it("keeps scaled metric display in recovered model context while preserving the original state", () => {
  const state = projectResearchState([], ["check_risk"]);
  state.operations.push({ callId: "risk", callEntryId: "call", resultEntryId: "result", requestEntryId: "request", tool: "check_risk",
    parameters: {}, status: "verified", reason: "fixture presentation", references: [],
    findings: { kind: "risk", title: "Fixture", assumptions: [], metrics: [{ label: "Annual volatility", value: 0.01, unit: "percent" }] } });
  const before = structuredClone(state), context = formatResearchContext(state);
  expect(context).toContain('"value":0.01,"unit":"fraction","display":"1%"');
  expect(state).toEqual(before);
});
