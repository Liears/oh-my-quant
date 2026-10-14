import { expect, test } from "bun:test";
import { Check } from "typebox/value";
import { createResearchTaskTool } from "../research-task-tool.ts";
import { projectResearchState } from "../../research/state.ts";
import { record } from "../../research/references.ts";

const task = { goal: "Audit supplied facts", scope: { symbols: ["AAPL"], market: "US", start: "2026-05-01", end: "2026-09-18" },
  constraints: { allowedTools: ["bash", "research_task"], notes: [] }, dataRefs: [], reportRequired: false,
  criteria: [{ id: "supplied", description: "Preserve supplied facts", tool: "supplied_snapshot_audit", parameters: {}, metrics: ["report_date"] }] };

test("the provider schema rejects fabricated narrative acceptance tools before execution", () => {
  const state = projectResearchState([], ["bash", "research_task"]);
  const tool = createResearchTaskTool(async () => ({ state, entries: [] }));
  expect(Check(tool.parameters, { action: "declare", expectedRevision: "initial:request", requestEntryId: "request", task })).toBe(false);
  for (const name of ["compute_factor", "check_risk", "score_benchmark", "alpha_backtest", "alpha_runs"]) {
    const calculation = { ...task, criteria: [{ ...task.criteria[0]!, tool: name }] };
    expect(Check(tool.parameters, { action: "declare", expectedRevision: "initial:request", requestEntryId: "request", task: calculation })).toBe(true);
  }
});

test("a workflow-only read exposes no quant acceptance capability and leaves the journal unchanged", async () => {
  const state = projectResearchState([], ["bash", "research_task", "custom_audit"]), before = structuredClone(state);
  const tool = createResearchTaskTool(async () => ({ state, entries: [] }));
  const result = await tool.execute("read", { action: "read" });
  expect(record(result.details)?.acceptanceTools).toEqual([]);
  expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("supplied-material interpretation") })]));
  expect(state).toEqual(before);
});

test("enabled acceptance tools are disclosed independently of the metric-discovery subset", async () => {
  const state = projectResearchState([], ["bash", "compute_factor", "alpha_runs", "score_benchmark", "research_task"]);
  const tool = createResearchTaskTool(async () => ({ state, entries: [] }));
  const data = record((await tool.execute("read", { action: "read" })).details)!;
  expect(data.acceptanceTools).toEqual(["compute_factor", "score_benchmark", "alpha_runs"]);
  expect(record(data.metricLabels)).toHaveProperty("compute_factor");
  expect(record(data.metricLabels)).not.toHaveProperty("score_benchmark");
});
