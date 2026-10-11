/** Recorded research choices, never account positions, author approval or executed orders. */
export interface ResearchDecisionRequest {
  requestId: string;
  comparisonId: string;
  declaredDate: string;
  choice: "retain" | "revise" | "defer" | "reject";
  rationale: string;
}
export interface ResearchDecision {
  version: 1;
  kind: "research-decision";
  id: string;
  recordedAt: string;
  provenance: "explicit-tool-input";
  request: ResearchDecisionRequest;
  comparisonHash: string;
}
