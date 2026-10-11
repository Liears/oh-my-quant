import { isDeepStrictEqual } from "node:util";
import type { ResearchState } from "../research/state.ts";
import { riskMetricClaimViolations } from "./risk-answer-claims.ts";

/** Bind labelled risk percentages to the selected, verified operation of the current single-asset task. */
export function auditCurrentRiskAnswer(state: ResearchState, text: string): {
  status: "not-risk" | "unavailable" | "audited"; violations: string[];
} {
  const task = state.task;
  const criteria = task?.spec.criteria.filter(item => item.tool === "check_risk") ?? [];
  if (task?.status !== "complete" || criteria.length === 0 || task.spec.scope.symbols.length !== 1)
    return { status: "not-risk", violations: [] };
  const symbol = task.spec.scope.symbols[0]!;
  const evidence = criteria.map(criterion => {
    const selected = task.criteria.find(item => item.id === criterion.id);
    return selected?.status === "satisfied" ? selected.evidence : null;
  });
  const first = evidence[0];
  if (!first || evidence.some(item => !item || item.callId !== first.callId || item.callEntryId !== first.callEntryId)
    || criteria.some(criterion => criterion.parameters.symbol !== symbol || criterion.parameters.start !== task.spec.scope.start
      || criterion.parameters.end !== task.spec.scope.end
      || criterion.parameters.market !== undefined && criterion.parameters.market !== task.spec.scope.market
      || !isDeepStrictEqual(criterion.parameters, criteria[0]!.parameters)))
    return { status: "unavailable", violations: [] };
  const operations = state.operations.filter(item => item.callId === first.callId && item.callEntryId === first.callEntryId);
  const operation = operations.length === 1 ? operations[0]! : null;
  if (operation?.tool !== "check_risk" || operation.status !== "verified" || operation.findings?.kind !== "risk"
    || !isDeepStrictEqual(operation.parameters, criteria[0]!.parameters))
    return { status: "unavailable", violations: [] };
  const annual = operation.findings.metrics.find(item => item.label === "Annual volatility");
  const drawdown = operation.findings.metrics.find(item => item.label === "Maximum drawdown");
  const downside = operation.findings.metrics.find(item => item.label === "Downside volatility");
  const var95 = operation.findings.metrics.find(item => item.label === "VaR 95%");
  const cvar95 = operation.findings.metrics.find(item => item.label === "CVaR 95%");
  const duration = operation.findings.metrics.find(item => item.label === "Drawdown duration");
  if ([annual, drawdown, downside, var95, cvar95].some(item => item?.unit !== "percent"
    || typeof item.value !== "number" || !Number.isFinite(item.value))
    || duration?.unit !== "periods" || typeof duration.value !== "number" || !Number.isSafeInteger(duration.value) || duration.value < 0)
    return { status: "unavailable", violations: [] };
  return { status: "audited", violations: riskMetricClaimViolations(text, {
    symbol, annualVolatility: annual!.value!, maxDrawdown: drawdown!.value!, downsideVolatility: downside!.value!,
    var95: var95!.value!, cvar95: cvar95!.value!, drawdownDuration: duration.value,
  }) };
}
