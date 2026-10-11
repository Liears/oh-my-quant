import { isDailyDate } from "../market/bars.ts";
import { loadPortfolioComparison, loadResearchDecision, researchDecisionHash } from "../storage/index.ts";
import type { ResearchDecisionRequest } from "../types/research-decision.ts";
import { verifyArchivedComparison } from "./archived-comparison.ts";

export function validateResearchDecisionRequest(request: ResearchDecisionRequest, asOf = new Date().toISOString().slice(0, 10)): void {
  if (!request || typeof request !== "object" || Object.keys(request).some(key => !["requestId", "comparisonId", "declaredDate", "choice", "rationale"].includes(key))
    || typeof request.requestId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(request.requestId)
    || typeof request.comparisonId !== "string" || !request.comparisonId
    || !isDailyDate(request.declaredDate) || request.declaredDate > asOf
    || !["retain", "revise", "defer", "reject"].includes(request.choice)
    || typeof request.rationale !== "string" || !request.rationale.trim() || request.rationale.length > 4000) throw new Error("Invalid research decision: use an explicit date, choice, rationale and stable request ID; no account/order fields.");
}

export function verifyResearchDecision(id: string) {
  const decision = loadResearchDecision(id);
  validateResearchDecisionRequest(decision.request, decision.recordedAt.slice(0, 10));
  const evidence = verifyArchivedComparison(loadPortfolioComparison(decision.request.comparisonId));
  if (evidence.comparisonHash !== decision.comparisonHash) throw new Error("Research decision comparison binding changed; original preserved.");
  return { decision, hash: researchDecisionHash(decision), groupIds: evidence.source.result.input.groups.map(group => group.id),
    comparisonWindow: { start: evidence.source.result.input.start, end: evidence.source.result.input.end },
    retrospective: decision.request.declaredDate < decision.recordedAt.slice(0, 10),
    evidenceAfterDeclaredDate: evidence.source.createdAt.slice(0, 10) > decision.request.declaredDate || evidence.source.result.input.end > decision.request.declaredDate };
}
