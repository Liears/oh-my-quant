import type { ResearchState } from "../../research/state.ts";
import { comparisonExcessClaimViolations } from "./comparison-answer-methods.ts";

/** A cited recorded report binds this check to WhyJ's annual comparison method, not unrelated alpha research. */
export function auditCurrentAnnualAnswer(state: ResearchState, text: string): {
  status: "not-annual" | "audited"; violations: string[];
} {
  const report = state.operations.findLast(operation => operation.status === "recorded"
    && ["annual_report", "annual_reports"].includes(operation.tool)
    && typeof operation.recordedScope?.id === "string" && operation.recordedScope.id.length > 0 && text.includes(operation.recordedScope.id));
  return report ? { status: "audited", violations: comparisonExcessClaimViolations(text) }
    : { status: "not-annual", violations: [] };
}
