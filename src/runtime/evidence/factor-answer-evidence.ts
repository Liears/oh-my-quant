import { isDeepStrictEqual } from "node:util";
import type { ResearchState } from "../../research/state.ts";
import { factorLatestClaimViolations, knownFactorAnswerViolations } from "./factor-answer-claims.ts";
import type { VerifiedFactorLatest } from "./factor-latest-claims.ts";
import { factorCloseObservationViolations } from "./factor-observation-claims.ts";

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
  const verified = new Map<string, VerifiedFactorLatest & { parameters: Record<string, unknown> }>();
  for (const criterion of factors) {
    if (!symbol || criterion.parameters.symbol !== symbol || criterion.parameters.start !== task.spec.scope.start
      || criterion.parameters.end !== task.spec.scope.end
      || criterion.parameters.market !== undefined && criterion.parameters.market !== task.spec.scope.market)
      return { status: "unavailable", violations: [] };
    const selected = task.criteria.find(item => item.id === criterion.id);
    const evidence = selected?.status === "satisfied" ? selected.evidence : null;
    if (!evidence) return { status: "unavailable", violations: [] };
    const operations = state.operations.filter(item => item.callId === evidence.callId && item.callEntryId === evidence.callEntryId);
    const operation = operations.length === 1 ? operations[0]! : null;
    if (operation?.tool !== "compute_factor" || operation.status !== "verified" || operation.findings?.kind !== "factor"
      || !isDeepStrictEqual(operation.parameters, criterion.parameters))
      return { status: "unavailable", violations: [] };
    const latest = operation.findings.metrics.find(item => item.label === "Latest");
    const { factor, period = 20 } = criterion.parameters;
    if (latest?.unit !== "number" || typeof latest.value !== "number" || !Number.isFinite(latest.value)
      || typeof factor !== "string" || typeof period !== "number")
      return { status: "unavailable", violations: [] };
    const key = `${factor}:${period}`;
    const previous = verified.get(key);
    if (previous && (previous.latest !== latest.value || !isDeepStrictEqual(previous.parameters, criterion.parameters)))
      return { status: "unavailable", violations: [] };
    verified.set(key, { factor, period, latest: latest.value, parameters: criterion.parameters });
  }
  return { status: "audited", violations: [...knownFactorAnswerViolations(text),
    ...factorLatestClaimViolations(text, [...verified.values()]),
    ...factorCloseObservationViolations(text, [...verified.values()])] };
}
