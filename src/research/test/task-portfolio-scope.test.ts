import { expect, test } from "bun:test";
import { createResearchTaskTool } from "../../tools/research-task-tool.ts";
import { projectResearchState } from "../state.ts";
import { initialResearchTaskRevision } from "../task-actions.ts";
import { record } from "../references.ts";

const task = { id: "comparison", goal: "Compare groups", scope: { symbols: ["AAPL", "MSFT"], market: "US", start: "2026-01-01", end: "2026-02-09" },
  constraints: { allowedTools: ["list_portfolios", "compare_portfolios"], notes: [] }, dataRefs: [], reportRequired: false,
  criteria: [{ id: "return", description: "Compare returns", tool: "compare_portfolios", parameters: { group_a: "Core", group_b: "Stable" }, metrics: ["Portfolio A / Total return"] }] };
const entries = [
  { id: "request", type: "message", message: { role: "user", content: "Compare Core and Stable using the read version" } },
  { id: "call", type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "list", name: "list_portfolios", arguments: {} }] } },
  { id: "result", type: "message", message: { role: "toolResult", toolCallId: "list", toolName: "list_portfolios", content: [], details: {
    revision: "version-1", groups: [{ id: "a", name: "Core", symbolCodes: ["AAPL"] }, { id: "b", name: "Stable", symbolCodes: ["MSFT"] }] } } },
];
const tools = ["list_portfolios", "compare_portfolios"];
test("new comparison declarations reject missing, invented or mismatched pins without changing state", async () => {
  const state = projectResearchState(entries, tools), before = structuredClone(state);
  const tool = createResearchTaskTool(async () => ({ entries, state }));
  for (const scope of [task.scope, { ...task.scope, portfolioRevision: "version-1" },
    { ...task.scope, portfolioRevision: "invented", groupIds: ["a", "b"] }, { ...task.scope, portfolioRevision: "version-1", groupIds: ["wrong", "b"] },
    { ...task.scope, portfolioRevision: "version-1", groupIds: ["b", "a"] }]) {
    await expect(tool.execute("declare", { action: "declare", expectedRevision: initialResearchTaskRevision("request"), requestEntryId: "request", task: { ...task, scope } })).rejects.toThrow();
  }
  const result = await tool.execute("declare", { action: "declare", expectedRevision: initialResearchTaskRevision("request"), requestEntryId: "request",
    task: { ...task, scope: { ...task.scope, portfolioRevision: "version-1", groupIds: ["a", "b"] } } });
  expect(record(record(result.details)?.event)?.type).toBe("declare");
  expect(state).toEqual(before);
});
test("legacy journal tasks remain readable without newly required declaration pins", () => {
  const historical = [{ id: "legacy", type: "custom_message", customType: "research_task", details: {
    version: 1, type: "declare", expectedRevision: null, task: { ...task, request: "Compare" } } }];
  const state = projectResearchState(historical, tools);
  expect(state.taskErrors).toEqual([]);
  expect(state.task?.spec.id).toBe("comparison");
});
