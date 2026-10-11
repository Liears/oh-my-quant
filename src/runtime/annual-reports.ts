import { renderAnnualResearch } from "../artifact/src/annual-renderer.ts";
import { assertRecordedAnnualInventoryUnchanged, selectRecordedAnnualDecisions } from "../research/annual-decision-selection.ts";
import { verifyAnnualResearch } from "../research/annual.ts";
import { listAnnualReportFiles, loadAnnualReport, materializeAnnualReport, saveAnnualReport } from "../storage/index.ts";
import type { AnnualReportRequest } from "../types/annual-report.ts";
import { isDeepStrictEqual } from "node:util";

export function generateAnnualReport(request: AnnualReportRequest, signal?: AbortSignal, decisionScope?: "all-recorded") {
  signal?.throwIfAborted();
  if (request.decisionSelection !== undefined) throw new Error("Annual decision selection metadata must be derived during generation, not supplied by a caller.");
  if (decisionScope !== undefined && decisionScope !== "all-recorded") throw new Error("Invalid annual decision scope.");
  if (decisionScope && request.decisionIds !== undefined)
    throw new Error("Select either explicit decision IDs or all recorded decisions, not both.");
  const selection = decisionScope ? selectRecordedAnnualDecisions(request, signal) : undefined;
  const frozenRequest: AnnualReportRequest = selection
    ? { ...request, decisionIds: selection.ids, decisionSelection: "all-recorded-at-generation" } : request;
  const research = verifyAnnualResearch(frozenRequest), createdAt = new Date().toISOString();
  const html = renderAnnualResearch(research, createdAt);
  signal?.throwIfAborted();
  if (selection) assertRecordedAnnualInventoryUnchanged(selection.files);
  const artifact = saveAnnualReport({ request: research.request, createdAt, comparisonHash: research.comparisonHash, perspectiveVersion: 1, html,
    ...(research.decisions.length ? { decisionHashes: research.decisions.map(entry => ({ id: entry.decision.id, hash: entry.hash })) } : {}) });
  return { ...annualSummary(artifact), interpretationNotes: research.analysis.assumptions, path: materializeAnnualReport(artifact) };
}

function annualSummary(artifact: ReturnType<typeof loadAnnualReport>) {
  return { version: artifact.version, kind: artifact.kind, id: artifact.id, createdAt: artifact.createdAt,
    request: artifact.request, comparisonHash: artifact.comparisonHash, perspectiveVersion: artifact.perspectiveVersion,
    accountPerformance: "not-connected" as const, strategyHistory: artifact.decisionHashes?.length ? "recorded-research-decisions" as const : "not-connected" as const,
    decisionHashes: artifact.decisionHashes ?? [] };
}

function checkAnnualBinding(artifact: ReturnType<typeof loadAnnualReport>, research: ReturnType<typeof verifyAnnualResearch>): void {
  if (research.comparisonHash !== artifact.comparisonHash
    || !isDeepStrictEqual(artifact.decisionHashes ?? [], research.decisions.map(entry => ({ id: entry.decision.id, hash: entry.hash })))) throw new Error("Annual report evidence binding changed; original files preserved.");
}

export function restoreAnnualReport(id: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const artifact = loadAnnualReport(id), research = verifyAnnualResearch(artifact.request, artifact.createdAt.slice(0, 10));
  checkAnnualBinding(artifact, research);
  signal?.throwIfAborted();
  return { ...annualSummary(artifact), interpretationNotes: research.analysis.assumptions, path: materializeAnnualReport(artifact) };
}

export function listAnnualReports(signal?: AbortSignal) {
  const items: ReturnType<typeof annualSummary>[] = [], unavailable: { file: string; reason: string }[] = [];
  for (const file of listAnnualReportFiles()) {
    signal?.throwIfAborted();
    try {
      const artifact = loadAnnualReport(file.slice(0, -5));
      const research = verifyAnnualResearch(artifact.request, artifact.createdAt.slice(0, 10));
      checkAnnualBinding(artifact, research);
      items.push(annualSummary(artifact));
    } catch (error) { unavailable.push({ file, reason: error instanceof Error ? error.message : "Report unavailable." }); }
  }
  return { items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), unavailable };
}
