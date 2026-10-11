import { expect, it } from "bun:test";
import { initialResearchTaskRevision, researchTaskAction } from "./task-actions.ts";
import { projectResearchTask } from "./tasks.ts";
import { record } from "./references.ts";
import type { ResearchEntry } from "./state.ts";

function fixture(): ResearchEntry[] {
  const input = { action: "declare", expectedRevision: null, requestEntryId: "request", task: {
    id: "task", goal: "保留用户窗口和费用假设", scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
    constraints: { allowedTools: ["run_backtest"], notes: [] }, dataRefs: [], reportRequired: false,
    criteria: [{ id: "return", description: "收益可核验", tool: "run_backtest", parameters: { symbol: "AAPL" }, metrics: ["Total return"] }],
  } };
  return [
    { id: "request", type: "message", message: { role: "displayUser", displayText: "用户原始研究要求", content: "增强后的提示不是用户原文" } },
    { id: "call", type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call-id", name: "research_task", arguments: input }] } },
    { id: "result", type: "message", message: { role: "toolResult", toolCallId: "call-id", toolName: "research_task", content: "叙述不能代替事件",
      details: { event: researchTaskAction(input, [{ entryId: "request", text: "用户原始研究要求" }]) }, isError: false } },
  ];
}

it("commits only a persisted task event bound to the exact originating call and user text", () => {
  const entries = fixture();
  expect(projectResearchTask(entries, [], ["run_backtest"]).task).toMatchObject({ revision: "result", startedEntryId: "result", status: "active", spec: { request: "用户原始研究要求" } });
  expect(projectResearchTask(entries.slice(0, 2), [], []).task).toBeNull();
  record(entries[2]!.message)!.isError = true;
  expect(projectResearchTask(entries, [], []).task).toBeNull();
});

it("rejects altered, ambiguous, missing and out-of-order task result bindings", () => {
  const changes: Array<(entries: ResearchEntry[]) => void> = [
    entries => { record(record(entries[2]!.message)!.details)!.event = { version: 1, type: "declare", expectedRevision: null, task: { goal: "forged" } }; },
    entries => { record(entries[2]!.message)!.toolCallId = "different-call"; },
    entries => { entries.push({ ...structuredClone(entries[2]!), id: "duplicate-result" }); },
    entries => { entries.splice(2, 0, { ...structuredClone(entries[1]!), id: "duplicate-call" }); },
    entries => { [entries[1], entries[2]] = [entries[2]!, entries[1]!]; },
    entries => { record(entries[0]!.message)!.displayText = "changed original input"; },
    entries => { record(entries[2]!.message)!.details = {}; },
  ];
  for (const change of changes) {
    const entries = fixture(); change(entries);
    const projected = projectResearchTask(entries, [], ["run_backtest"]);
    expect(projected.task).toBeNull(); expect(projected.errors.length).toBeGreaterThan(0);
  }
});

it("rejects declarations bound to an older request and refuses malformed actions", () => {
  const entries = fixture();
  entries.splice(1, 0, { id: "new-request", type: "message", message: { role: "user", content: "修改研究目标" } });
  const projected = projectResearchTask(entries, [], []);
  expect(projected.task).toBeNull(); expect(projected.errors[0]?.reason).toContain("latest requestEntryId");
  for (const input of [null, {}, { action: "declare", expectedRevision: 12 }, { action: "cancel", expectedRevision: null, reason: "stop" },
    { action: "resolve", expectedRevision: "result", reason: "done", from: {}, to: {} }]) expect(() => researchTaskAction(input, [])).toThrow();
});

it("replays a request-bound initial token as the same null precondition without changing stored evidence", () => {
  const entries = fixture();
  const previous = projectResearchTask(entries, [], ["run_backtest"]);
  const content = record(entries[1]!.message)!.content as unknown[];
  const call = record(content[0])!;
  record(call.arguments)!.expectedRevision = initialResearchTaskRevision("request");
  expect(projectResearchTask(entries, [], ["run_backtest"])).toEqual(previous);
  record(call.arguments)!.expectedRevision = initialResearchTaskRevision("different-request");
  expect(projectResearchTask(entries, [], ["run_backtest"]).task).toBeNull();
});

it("commits a stable host ID when the first model declaration omits task.id", () => {
  const entries = fixture();
  const call = record((record(entries[1]!.message)!.content as unknown[])[0])!;
  const args = record(call.arguments)!, task = record(args.task)!;
  delete task.id;
  args.expectedRevision = initialResearchTaskRevision("request");
  record(record(entries[2]!.message)!.details)!.event = researchTaskAction(args, [{ entryId: "request", text: "用户原始研究要求" }]);
  expect(task.id).toBeUndefined();
  expect(projectResearchTask(entries, [], ["run_backtest"]).task?.spec).toMatchObject({
    id: "study-request", request: "用户原始研究要求", goal: "保留用户窗口和费用假设",
  });
});
