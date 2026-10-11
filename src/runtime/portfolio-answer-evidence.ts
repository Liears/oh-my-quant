import type { ResearchState } from "../research/state.ts";
import { portfolioMetricClaimViolations, type VerifiedPortfolioAnswerMetrics } from "./portfolio-answer-claims.ts";

/** Bind answer claims to the exact comparison accepted by the current completed task. */
export function auditCurrentPortfolioAnswer(state: ResearchState, text: string): {
  status: "not-portfolio" | "unavailable" | "audited"; violations: string[];
} {
  const task = state.task;
  if (task?.status !== "complete" || !task.spec.criteria.length || task.spec.criteria.some(item => item.tool !== "compare_portfolios"))
    return { status: "not-portfolio", violations: [] };
  const evidence = task.criteria.map(item => item.status === "satisfied" ? item.evidence : null);
  if (evidence.length !== task.spec.criteria.length || evidence.some(item => !item)
    || evidence.some(item => item!.callId !== evidence[0]!.callId || item!.callEntryId !== evidence[0]!.callEntryId))
    return { status: "unavailable", violations: [] };
  const operations = state.operations.filter(item => item.callId === evidence[0]!.callId && item.callEntryId === evidence[0]!.callEntryId);
  const operation = operations.length === 1 ? operations[0]! : null;
  const comparison = operation?.comparison;
  if (operation?.tool !== "compare_portfolios" || operation.status !== "verified" || operation.findings?.kind !== "portfolio-comparison"
    || comparison?.groups.length !== 2
    || operation.parameters.group_a !== comparison.groups[0]!.id && operation.parameters.group_a !== comparison.groups[0]!.name
    || operation.parameters.group_b !== comparison.groups[1]!.id && operation.parameters.group_b !== comparison.groups[1]!.name
    || task.spec.scope.portfolioRevision && task.spec.scope.portfolioRevision !== comparison.portfolioRevision
    || task.spec.scope.groupIds && (task.spec.scope.groupIds[0] !== comparison.groups[0]!.id || task.spec.scope.groupIds[1] !== comparison.groups[1]!.id))
    return { status: "unavailable", violations: [] };
  const metric = (label: string) => operation.findings?.metrics.find(item => item.label === label)?.value;
  const aReturn = metric("Portfolio A / Total return"), bReturn = metric("Portfolio B / Total return");
  const aDrawdown = metric("Portfolio A / Max drawdown"), bDrawdown = metric("Portfolio B / Max drawdown");
  if (!comparison.groups[0]!.name || !comparison.groups[1]!.name || comparison.groups[0]!.name === comparison.groups[1]!.name
    || typeof aReturn !== "number" || !Number.isFinite(aReturn) || typeof bReturn !== "number" || !Number.isFinite(bReturn)
    || typeof aDrawdown !== "number" || !Number.isFinite(aDrawdown) || typeof bDrawdown !== "number" || !Number.isFinite(bDrawdown))
    return { status: "unavailable", violations: [] };
  const groups: VerifiedPortfolioAnswerMetrics["groups"] = [
    { name: comparison.groups[0]!.name, totalReturn: aReturn, maxDrawdown: aDrawdown },
    { name: comparison.groups[1]!.name, totalReturn: bReturn, maxDrawdown: bDrawdown },
  ];
  return { status: "audited", violations: portfolioMetricClaimViolations(text, { groups }) };
}
