import type { ResearchTaskSnapshot } from "../../types/research-task.ts";

/** Local inspection uses the projection directly, never asks the model to restate it. */
export function researchTaskLines(snapshot: ResearchTaskSnapshot): string[] {
  const task = snapshot.task;
  const errors = snapshot.taskErrors.map(error => `Invalid task record ${error.entryId}: ${error.reason}`);
  if (!task) return ["No declared research task.", "Enter a research request with instruments, dates and required results.", ...errors];
  const { spec } = task;
  return [
    `Goal: ${spec.goal}`, `Status: ${task.status}`, `Request: ${spec.request}`,
    `Scope: ${spec.scope.symbols.join(", ")} · ${spec.scope.market}`, `Window: ${spec.scope.start} to ${spec.scope.end}`,
    ...(spec.scope.benchmark ? [`Benchmark: ${spec.scope.benchmark}`] : []),
    ...(spec.scope.groupIds ? [`Groups: ${spec.scope.groupIds.join(", ")}`] : []),
    ...(spec.scope.portfolioRevision ? [`Group revision: ${spec.scope.portfolioRevision}`] : []),
    `Allowed tools: ${spec.constraints.allowedTools.join(", ")}`, ...spec.constraints.notes.map(note => `Constraint note: ${note}`),
    "", `Acceptance: ${task.criteria.filter(item => item.status === "satisfied").length}/${spec.criteria.length} satisfied`,
    ...spec.criteria.flatMap(criterion => {
      const current = task.criteria.find(item => item.id === criterion.id);
      return [`${criterion.id}: ${current?.status ?? "pending"} · ${criterion.description}`, `  ${criterion.tool} ${JSON.stringify(criterion.parameters)}`,
        `  Required metrics: ${criterion.metrics.join(", ") || "verified result"}`, `  ${current?.reason ?? "No evidence yet."}`,
        ...(current?.evidence ? [`  Evidence: ${current.evidence.callEntryId} / ${current.evidence.callId}`] : [])];
    }),
    "", ...task.reasons.map(reason => `Missing: ${reason}`),
    ...snapshot.unresolved.filter(attempt => task.unresolved.some(item => item.callEntryId === attempt.callEntryId && item.callId === attempt.callId))
      .map(attempt => `Unresolved ${attempt.tool}: ${attempt.reason}`),
    ...task.resolutions.map(item => `Retry ${item.active ? "resolved" : "reopened"}: ${item.from.callId} → ${item.to.callId} · ${item.reason}`),
    ...spec.dataRefs.map(ref => `Pinned input: ${ref.symbol} · ${ref.kind} · ${ref.revision} · ${ref.contentHash}`),
    `Report: ${task.reportRef ?? (spec.reportRequired ? "required, missing" : "not required")}`,
    ...(task.reportRef ? [`Report available: ${task.reportAvailable === null ? "unchecked" : task.reportAvailable}`] : []),
    `Task revision: ${task.revision}`, "Completion covers the declared criteria and, when required, an available immutable report version.",
    "Close this view to continue, revise or end the task in the composer.", ...errors,
  ];
}
