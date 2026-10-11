/** Observation research only. No balances, positions or private account history. */
export interface AnnualReportRequest {
  comparisonId: string;
  year: number;
  valuationCutoff: string;
  decisionIds?: string[];
  /** Frozen opt-in local journal inventory; later records do not rewrite this report. */
  decisionSelection?: "all-recorded-at-generation";
}

export interface AnnualReportArtifact {
  version: 1;
  kind: "annual-research-report";
  id: string;
  createdAt: string;
  request: AnnualReportRequest;
  comparisonHash: string;
  perspectiveVersion: 1;
  decisionHashes?: Array<{ id: string; hash: string }>;
  /** Original offline document, retained across renderer upgrades. */
  html: string;
}
