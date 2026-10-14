import { createHash } from "node:crypto";
import { loadDataset } from "../storage/index.ts";
import { isDailyDate, normalizeBarSeries } from "../market/bars.ts";
import { inferMarket, normalizeSymbol } from "../market/symbols.ts";
import { isSafeProviderEndpoint } from "../market/provider-endpoint.ts";
import { isPriceAdjustment } from "../market/price-adjustment.ts";
import type { Bar, DatasetRef } from "../types/data.ts";
import type { ResearchBarsDataset, ResearchReport } from "./types.ts";
import { verifyResearchAnalysis } from "./analysis.ts";
import { verifyArchivedResearchAnalysis } from "./archive-analysis.ts";
import { resolveResearchFund, verifyFundResearch } from "./fund.ts";
import type { FundNavDatasetRef, FundNavSnapshot } from "../types/fund-data.ts";
import { record, researchReferences } from "./references.ts";
import { verifyResearchDashboard, UnboundDashboardResult } from "./dashboard.ts";
import { verifyResearchComparison, UnboundComparisonResult } from "./comparison.ts";
import type { PortfolioComparisonArtifact } from "../types/portfolio-comparison.ts";
import type { AlphaRunArtifact } from "../types/alpha.ts";
import { verifyResearchAlpha } from "./alpha.ts";

/** Explicit field projection; source strings, paths and unknown properties cannot become share content. */
function publicReference(value: unknown): DatasetRef | undefined {
  const raw = record(value), requested = record(raw?.requested);
  if (!raw || !requested || raw.version !== 1 || raw.kind !== "daily-bars"
    || typeof raw.symbol !== "string" || !/^[A-Z0-9^.\-]{1,24}$/.test(raw.symbol)
    || !["akshare", "tushare", "llmquant-data", "financial-datasets"].includes(String(raw.source))
    || typeof raw.revision !== "string" || !/^[a-f0-9]{64}$/.test(raw.revision)
    || typeof raw.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(raw.contentHash)
    || !Array.isArray(raw.dates) || !raw.dates.length || !raw.dates.every(date => typeof date === "string" && isDailyDate(date))
    || (requested.start !== null && (typeof requested.start !== "string" || !isDailyDate(requested.start)))
    || (requested.end !== null && (typeof requested.end !== "string" || !isDailyDate(requested.end)))
    || typeof raw.snapshotAt !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(raw.snapshotAt) || !Number.isFinite(Date.parse(raw.snapshotAt))
    || !isPriceAdjustment(raw.adjustment) || raw.availability !== "observed-at-fetch"
    || (raw.providerEndpoint !== undefined && !isSafeProviderEndpoint(raw.providerEndpoint))) return;
  try {
    if (normalizeSymbol(raw.symbol) !== raw.symbol || inferMarket(raw.symbol) !== raw.market) return;
  } catch { return; }
  return {
    version: 1, kind: "daily-bars", symbol: raw.symbol, source: String(raw.source), market: inferMarket(raw.symbol),
    revision: raw.revision, contentHash: raw.contentHash, dates: [...raw.dates] as string[],
    requested: { start: requested.start as string | null, end: requested.end as string | null },
    snapshotAt: raw.snapshotAt, adjustment: raw.adjustment, availability: "observed-at-fetch",
    ...(raw.providerEndpoint ? { providerEndpoint: raw.providerEndpoint } : {}),
  };
}

/** Shared archive verification for journal reports and explicit saved-study reports. */
export function resolveResearchBars(candidate: unknown, resolve: (ref: DatasetRef) => Bar[] = loadDataset): ResearchBarsDataset {
  const ref = publicReference(candidate);
  if (!ref) throw new Error("Invalid public observation reference.");
  const bars = normalizeBarSeries(resolve(ref));
  const hash = createHash("sha256").update(JSON.stringify(bars)).digest("hex");
  if (hash !== ref.contentHash || bars.length !== ref.dates.length || bars.some((bar, i) => bar.date !== ref.dates[i])
    || (ref.requested.start && bars[0]!.date < ref.requested.start) || (ref.requested.end && bars.at(-1)!.date > ref.requested.end)) throw new Error("Observation mismatch");
  return { ref, bars };
}

/** Normalize public observations, then verify analyses independently of narrative rendering. */
export function buildResearchReport(input: { lines: Array<{ type: string; message?: unknown; id?: unknown }> }, resolve: (ref: DatasetRef) => Bar[] = loadDataset, resolveFund?: (ref: FundNavDatasetRef) => FundNavSnapshot,
  resolveComparison?: (id: string) => PortfolioComparisonArtifact, resolveAlpha?: (id: string) => AlphaRunArtifact): ResearchReport {
  const report: ResearchReport = { version: 1, bindings: [], datasets: [], analyses: [], exclusions: { unavailableInputs: 0, unverifiedResults: 0, unsupportedResults: 0 } };
  const datasets = new Map<string, number>();
  const calls = new Map<string, { name: string; args: Record<string, unknown>; entryId: string | null } | null>();
  const callCounts = new Map<string, number>(), resultCounts = new Map<string, number>();
  for (const entry of input.lines) {
    const message = entry.type === "message" ? record(entry.message) : undefined;
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const value of message.content) {
        const block = record(value);
        if (block?.type === "toolCall" && typeof block.id === "string") callCounts.set(block.id, (callCounts.get(block.id) ?? 0) + 1);
      }
    }
    if (message?.role === "toolResult" && typeof message.toolCallId === "string") resultCounts.set(message.toolCallId, (resultCounts.get(message.toolCallId) ?? 0) + 1);
  }
  for (const entry of input.lines) {
    const message = entry.type === "message" ? record(entry.message) : undefined;
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const value of message.content) {
        const block = record(value);
        if (block?.type !== "toolCall" || typeof block.id !== "string" || typeof block.name !== "string") continue;
        const args = record(block.arguments);
        calls.set(block.id, calls.has(block.id) || !args ? null : { name: block.name, args, entryId: typeof entry.id === "string" ? entry.id : null });
      }
    }
    if (message?.role !== "toolResult" || message.isError) continue;
    const details = record(message.details);
    if (!details) continue;
    const error = record(details.error);
    if (typeof error?.code === "string" && typeof error.message === "string") continue;
    const name = String(message.toolName ?? "");
    const roles: Record<string, number> = {};
    for (const [role, candidate] of researchReferences(name, details)) {
      if (!candidate) continue;
      if (record(candidate)?.kind === "fund-nav") {
        try {
          const dataset = resolveResearchFund(candidate, resolveFund), key = JSON.stringify(dataset.ref);
          let index = datasets.get(key);
          if (index === undefined) { index = report.datasets.length; report.datasets.push(dataset); datasets.set(key, index); }
          roles[role] = index;
        } catch { report.exclusions.unavailableInputs++; }
        continue;
      }
      const ref = publicReference(candidate);
      if (!ref) { report.exclusions.unavailableInputs++; continue; }
      const key = JSON.stringify(ref);
      let index = datasets.get(key);
      if (index === undefined) {
        try {
          const dataset = resolveResearchBars(ref, resolve);
          index = report.datasets.length;
          report.datasets.push(dataset);
          datasets.set(key, index);
        } catch { report.exclusions.unavailableInputs++; continue; }
      }
      roles[role] = index;
    }
    if ((name === "show_dashboard" && details.methodVersion !== 1) || (name === "fund_dca_backtest" && details.methodVersion !== 2)) { report.exclusions.unsupportedResults++; continue; }
    if (name === "portfolio_comparisons" && details.kind !== "portfolio-comparison") continue;
    if (name === "alpha_runs" && details.kind !== "alpha-backtest") continue;
    if (!["compute_factor", "check_risk", "run_backtest", "analyze_archived_bars", "score_benchmark", "fund_dca_backtest", "show_dashboard", "compare_portfolios", "portfolio_comparisons", "alpha_backtest", "alpha_runs"].includes(name)) continue;
    const callId = String(message.toolCallId ?? "");
    const call = calls.get(callId);
    if (!call || call.name !== name || callCounts.get(callId) !== 1 || resultCounts.get(callId) !== 1) { report.exclusions.unverifiedResults++; continue; }
    try {
      const analysis = name === "fund_dca_backtest" ? verifyFundResearch(call.args, details, roles.input, report.datasets)
        : name === "analyze_archived_bars" ? verifyArchivedResearchAnalysis(call.args, details, roles, report.datasets)
        : name === "alpha_backtest" || name === "alpha_runs" ? verifyResearchAlpha(name, call.args, details, roles, report.datasets, resolveAlpha)
        : name === "show_dashboard" ? verifyResearchDashboard(call.args, details, roles, report.datasets)
        : name === "compare_portfolios" || name === "portfolio_comparisons" ? verifyResearchComparison(name, call.args, details, roles, report.datasets, resolveComparison)
        : verifyResearchAnalysis(name, call.args, details, roles, report.datasets);
      report.bindings.push({ analysisIndex: report.analyses.length, toolName: name, toolCallId: callId, callEntryId: call.entryId, resultEntryId: typeof entry.id === "string" ? entry.id : null });
      report.analyses.push(analysis);
    } catch (error) {
      if (error instanceof UnboundDashboardResult || error instanceof UnboundComparisonResult) report.exclusions.unsupportedResults++; else report.exclusions.unverifiedResults++;
    }
  }
  return report;
}
