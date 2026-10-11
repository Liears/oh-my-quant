import { listResearchDecisionFiles, loadPortfolioComparison, saveResearchDecision } from "../storage/index.ts";
import { validateResearchDecisionRequest, verifyResearchDecision } from "../research/decisions.ts";
import { verifyArchivedComparison } from "../research/archived-comparison.ts";
import type { ResearchDecisionRequest } from "../types/research-decision.ts";

export function recordResearchDecision(request: ResearchDecisionRequest, signal?: AbortSignal) {
  signal?.throwIfAborted(); validateResearchDecisionRequest(request);
  const evidence = verifyArchivedComparison(loadPortfolioComparison(request.comparisonId));
  signal?.throwIfAborted();
  const decision = saveResearchDecision(request, evidence.comparisonHash);
  return verifyResearchDecision(decision.id);
}
export function readResearchDecisions(id?: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (id) return { items: [verifyResearchDecision(id)], unavailable: [] };
  const items: ReturnType<typeof verifyResearchDecision>[] = [], unavailable: { file: string; reason: string }[] = [];
  for (const file of listResearchDecisionFiles()) {
    signal?.throwIfAborted();
    try { items.push(verifyResearchDecision(file.slice(0, -5))); }
    catch (error) { unavailable.push({ file, reason: error instanceof Error ? error.message : "Decision unavailable." }); }
  }
  return { items: items.sort((a, b) => a.decision.request.declaredDate.localeCompare(b.decision.request.declaredDate) || a.decision.recordedAt.localeCompare(b.decision.recordedAt) || a.decision.id.localeCompare(b.decision.id)), unavailable };
}
