import type { ResearchTaskEvent } from "../types/research-task.ts";
import type { ResearchOperation } from "./state.ts";
import { record } from "./references.ts";

/** Validate new declarations only. Historical journal projection retains its original contract. */
export function validatePortfolioTaskDeclaration(event: ResearchTaskEvent, operations: readonly ResearchOperation[]): void {
  if (event.type !== "declare") return;
  const criteria = event.task.criteria.filter(item => item.tool === "compare_portfolios");
  if (!criteria.length) return;
  const { portfolioRevision, groupIds } = event.task.scope;
  if (!portfolioRevision || !groupIds?.length) {
    throw new Error("Portfolio comparison declarations require task.scope.portfolioRevision and task.scope.groupIds. Read list_portfolios and copy its exact revision and selected group IDs before declaring.");
  }
  const observed = operations.findLast(operation => operation.tool === "list_portfolios" && operation.status === "recorded");
  if (!observed) return; // Typed callers may supply explicit version pins before the first tool observation.
  const scope = observed.recordedScope;
  if (scope?.revision !== portfolioRevision) throw new Error("Declared portfolioRevision does not match the observed list_portfolios revision. Preserve an explicitly requested version; do not silently replace it.");
  const groups = Array.isArray(scope.groups) ? scope.groups.map(record).filter(group => !!group) : [];
  const selected = new Set<string>();
  for (const criterion of criteria) for (const key of ["group_a", "group_b"] as const) {
    const requested = criterion.parameters[key];
    const matches = groups.filter(group => group.id === requested || group.name === requested);
    if (matches.length !== 1 || typeof matches[0]!.id !== "string") throw new Error("Comparison group parameters must identify the observed portfolio groups unambiguously.");
    selected.add(matches[0]!.id as string);
  }
  if (selected.size !== groupIds.length || groupIds.some((id, index) => id !== [...selected][index])) {
    throw new Error("task.scope.groupIds must match the selected comparison group IDs from list_portfolios.");
  }
}
