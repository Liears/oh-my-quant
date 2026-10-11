import { isDeepStrictEqual } from "node:util";
import type { ResearchState } from "../research/state.ts";
import { factorLatestClaimViolations, knownFactorAnswerViolations } from "./factor-answer-claims.ts";

/** Scope a narrow language check to the current completed factor/risk task. */
export function auditCurrentFactorAnswer(state: ResearchState, text: string): {
  status: "not-factor" | "unavailable" | "audited"; violations: string[];
} {
  const task = state.task;
  const criteria = task?.spec.criteria ?? [];
  if (task?.status !== "complete" || !criteria.some(item => item.tool === "compute_factor")
    || !criteria.every(item => item.tool === "compute_factor" || item.tool === "check_risk"))
    return { status: "not-factor", violations: [] };
  const factors = criteria.filter(item => item.tool === "compute_factor");
  const symbol = task.spec.scope.symbols.length === 1 ? task.spec.scope.symbols[0] : null;
  const evidence = factors.map(criterion => {
    const selected = task.criteria.find(item => item.id === criterion.id);
    return selected?.status === "satisfied" ? selected.evidence : null;
  });
  const first = evidence[0];
  if (!symbol || !first || evidence.some(item => !item || item.callId !== first.callId || item.callEntryId !== first.callEntryId)
    || factors.some(criterion => criterion.parameters.symbol !== symbol || criterion.parameters.start !== task.spec.scope.start
      || criterion.parameters.end !== task.spec.scope.end
      || criterion.parameters.market !== undefined && criterion.parameters.market !== task.spec.scope.market
      || !isDeepStrictEqual(criterion.parameters, factors[0]!.parameters)))
    return { status: "unavailable", violations: [] };
  const operations = state.operations.filter(item => item.callId === first.callId && item.callEntryId === first.callEntryId);
  const operation = operations.length === 1 ? operations[0]! : null;
  if (operation?.tool !== "compute_factor" || operation.status !== "verified" || operation.findings?.kind !== "factor"
    || !isDeepStrictEqual(operation.parameters, factors[0]!.parameters))
    return { status: "unavailable", violations: [] };
  const latest = operation.findings.metrics.find(item => item.label === "Latest");
  if (latest?.unit !== "number" || typeof latest.value !== "number" || !Number.isFinite(latest.value)
    || typeof factors[0]!.parameters.factor !== "string")
    return { status: "unavailable", violations: [] };
  return { status: "audited", violations: [...knownFactorAnswerViolations(text), ...factorLatestClaimViolations(text, {
    factor: factors[0]!.parameters.factor, latest: latest.value,
  })] };
}
