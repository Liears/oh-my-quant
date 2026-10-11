import { expect, test } from "bun:test";
import { createResearchTaskTool } from "./research-task-tool.ts";
import { projectResearchState } from "../research/state.ts";
import { record } from "../research/references.ts";

test("discovers the verified metric labels available to each archived price analysis mode", async () => {
  const state = projectResearchState([], ["analyze_archived_bars"]);
  const tool = createResearchTaskTool(async () => ({ state, entries: [] }));
  const labels = record(record((await tool.execute("read-archive", { action: "read" })).details)?.metricLabels)!;
  expect(labels.analyze_archived_bars).toContain("Latest");
  expect(labels.analyze_archived_bars).toContain("Total return");
  expect(labels.analyze_archived_bars).toContain("VaR 95%");
  expect(labels).not.toHaveProperty("run_backtest");
});

test("discovers portfolio metrics before declaration without assuming a benchmark or changing state", async () => {
  const state = projectResearchState([], ["compare_portfolios", "portfolio_comparisons"]), before = structuredClone(state);
  const tool = createResearchTaskTool(async () => ({ state, entries: [] }));
  const result = await tool.execute("read", { action: "read" });
  const data = record(result.details)!, labels = record(data.metricLabels)!;
  expect(labels.compare_portfolios).toContain("Portfolio A / Total return");
  expect(labels.compare_portfolios).toContain("Portfolio B / Max drawdown");
  expect(labels.compare_portfolios).toHaveLength(19);
  expect(labels.portfolio_comparisons).toEqual(labels.compare_portfolios);
  expect(JSON.stringify(labels)).not.toContain("Benchmark ·");
  expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("Portfolio A / Total return") })]));
  expect(state).toEqual(before);
});

test("uses an explicit benchmark only for read-time metric discovery and respects enabled tools", async () => {
  const state = projectResearchState([], ["portfolio_comparisons"]), before = structuredClone(state);
  const tool = createResearchTaskTool(async () => ({ state, entries: [] }));
  const data = record((await tool.execute("read", { action: "read", benchmark: "spy" })).details)!;
  const labels = record(data.metricLabels)!;
  expect(data.metricLabelBenchmark).toBe("SPY");
  expect(labels.portfolio_comparisons).toHaveLength(28);
  expect(labels.portfolio_comparisons).toContain("Benchmark · SPY / Total return");
  expect(labels).not.toHaveProperty("compare_portfolios");
  expect(state).toEqual(before);
  await expect(tool.execute("bad", { action: "read", benchmark: "not a symbol" })).rejects.toThrow("benchmark");
  await expect(tool.execute("bad", { action: "cancel", benchmark: "SPY" })).rejects.toThrow("only for read");
});

test("uses the declared benchmark by default and allows discovery for a later study without changing it", async () => {
  const entries = [{ id: "declaration", type: "custom_message", customType: "research_task", details: {
    version: 1, type: "declare", expectedRevision: null, task: { id: "study", request: "Compare with SPY", goal: "Compare with SPY",
      scope: { symbols: ["AAPL", "MSFT"], market: "US", start: "2026-01-01", end: "2026-02-09", benchmark: "SPY" },
      constraints: { allowedTools: ["compare_portfolios"], notes: [] }, dataRefs: [], reportRequired: false,
      criteria: [{ id: "return", description: "Core return", tool: "compare_portfolios", parameters: {}, metrics: ["Portfolio A / Total return"] }],
    },
  } }];
  const state = projectResearchState(entries, ["compare_portfolios"]), before = structuredClone(state);
  expect(state.task?.status).toBe("active");
  const tool = createResearchTaskTool(async () => ({ state, entries }));
  const original = record((await tool.execute("read", { action: "read" })).details)!;
  expect(original.metricLabelBenchmark).toBe("SPY");
  const next = record((await tool.execute("read", { action: "read", benchmark: "QQQ" })).details)!;
  expect(record(next.metricLabels)!.compare_portfolios).toContain("Benchmark · QQQ / Total return");
  expect(record(next.metricLabels)!.compare_portfolios).not.toContain("Benchmark · SPY / Total return");
  expect(state).toEqual(before);
});
