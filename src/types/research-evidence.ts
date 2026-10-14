import type { DatasetRef } from "./data.ts";
import type { FundNavDatasetRef } from "./fund-data.ts";

export interface ReportProvenance {
  version: 1;
  sessionHash: string;
  entryHash: string;
  scope: "branch" | "transcript";
  leafId: string | null;
  entryIds: string[];
  datasets: Array<{
    toolCallId: string;
    toolName: string;
    role: string;
    ref: DatasetRef | FundNavDatasetRef;
    verified: boolean;
  }>;
}
