/** Match a labelled fund answer only to the current task's verified calculation. */
import { isDeepStrictEqual } from "node:util";
import { normalizeFundSymbol } from "../../market/fund-nav.ts";
import type { ResearchOperation, ResearchState } from "../../research/state.ts";
import { principalFormulaClaimViolations, verifiedFundMetricClaimViolations } from "./fund-answer-claims.ts";
import type { VerifiedFundAnswerMetrics } from "./fund-answer-claims.ts";
import { fundComparisonClaimViolations } from "./fund-comparison-claims.ts";

function parametersMatch(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => {
    if (key !== "symbol") return isDeepStrictEqual(actual[key], value);
    try { return normalizeFundSymbol(actual[key] as string) === normalizeFundSymbol(value as string); }
    catch { return false; }
  });
}

export function matchingVerifiedFundOperations(state: ResearchState, expected: Record<string, unknown>): ResearchOperation[] {
  return state.operations.filter(operation => operation.tool === "fund_dca_backtest" && operation.status === "verified"
    && parametersMatch(operation.parameters, expected));
}

export function verifiedFundMetrics(state: ResearchState, expected: Record<string, unknown>): VerifiedFundAnswerMetrics | null {
  const operations = matchingVerifiedFundOperations(state, expected);
  if (!operations.length) return null;
  const values = operations.map(operation => {
    const metric = (label: string) => operation.findings?.metrics.find(item => item.label === label)?.value;
    return { principalReturn: metric("Principal return"), timeWeightedReturn: metric("Time-weighted return"),
      maximumDrawdownTwr: metric("Maximum drawdown (TWR)") };
  });
  const first = values[0]!;
  if (values.some(item => Object.values(item).some(value => typeof value !== "number" || !Number.isFinite(value)))
    || values.some(item => (Object.keys(first) as Array<keyof typeof first>).some(key =>
      Math.abs((item[key] as number) - (first[key] as number)) > 1e-10))) return null;
  return first as VerifiedFundAnswerMetrics;
}

export function auditCurrentFundAnswer(state: ResearchState, text: string): { status: "not-fund" | "unavailable" | "audited"; violations: string[] } {
  const criteria = state.task?.spec.criteria.filter(criterion => criterion.tool === "fund_dca_backtest") ?? [];
  if (state.task?.status !== "complete" || !criteria.length || criteria.length !== state.task.spec.criteria.length
    || criteria.some(criterion => !parametersMatch(criterion.parameters, criteria[0]!.parameters)
      || !parametersMatch(criteria[0]!.parameters, criterion.parameters)))
    return { status: "not-fund", violations: [] };
  const evidence = verifiedFundMetrics(state, criteria[0]!.parameters);
  if (!evidence) return { status: "unavailable", violations: [] };
  return { status: "audited", violations: [...verifiedFundMetricClaimViolations(text, evidence), ...principalFormulaClaimViolations(text),
    ...fundComparisonClaimViolations(text)] };
}
