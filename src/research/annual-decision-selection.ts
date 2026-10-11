import { listResearchDecisionFiles } from "../storage/index.ts";
import type { AnnualReportRequest } from "../types/annual-report.ts";
import { verifyAnnualResearch } from "./annual.ts";
import { verifyResearchDecision } from "./decisions.ts";

/** Explicit snapshot of locally recorded research declarations, not a claim about all actual decisions. */
export function selectRecordedAnnualDecisions(request: AnnualReportRequest, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const annual = verifyAnnualResearch(request), input = annual.source.result.input;
  const start = `${request.year}-01-01`, files = listResearchDecisionFiles();
  const eligible: ReturnType<typeof verifyResearchDecision>[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    if (!/^[a-f0-9]{64}\.json$/.test(file)) throw new Error("Stored research decision inventory is unavailable; no annual report saved.");
    let entry: ReturnType<typeof verifyResearchDecision>;
    try { entry = verifyResearchDecision(file.slice(0, -5)); }
    catch { throw new Error("Stored research decision inventory is unavailable; no annual report saved."); }
    if (entry.decision.request.declaredDate >= start && entry.decision.request.declaredDate <= request.valuationCutoff
      && entry.comparisonWindow.start >= start && entry.comparisonWindow.end <= request.valuationCutoff
      && entry.groupIds.length === input.groups.length
      && entry.groupIds.every((id, index) => id === input.groups[index]?.id)) eligible.push(entry);
  }
  if (!eligible.length) throw new Error("No eligible recorded research decisions for these groups and annual window; no annual report saved.");
  if (eligible.length > 20) throw new Error("More than 20 eligible recorded research decisions; narrow the selection explicitly. No annual report saved.");
  eligible.sort((a, b) => a.decision.request.declaredDate.localeCompare(b.decision.request.declaredDate)
    || a.decision.recordedAt.localeCompare(b.decision.recordedAt) || a.decision.id.localeCompare(b.decision.id));
  return { ids: eligible.map(entry => entry.decision.id), files };
}

export function assertRecordedAnnualInventoryUnchanged(files: readonly string[]): void {
  const current = listResearchDecisionFiles();
  if (current.length !== files.length || current.some((file, index) => file !== files[index]))
    throw new Error("Research decision inventory changed during annual generation; retry without saving a partial report.");
}
