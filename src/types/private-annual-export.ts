/** Paths stay in the local terminal host; only IDs and file locations cross the panel boundary. */
export interface PrivateAnnualExportRequest {
  comparisonId: string;
  year: number;
  valuationCutoff: string;
  historyFile: string;
  output: string;
  decisionIds: string[];
}
