import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { DataSource } from "../../source/index.ts";
import type { Market } from "../../types/data.ts";
import type { BarsFetchResult } from "../../source/index.ts";
import { validateDateRange } from "../../market/bars.ts";
import { normalizeSymbol } from "../../market/symbols.ts";
import { validateObservationCutoff } from "../../market/observation-cutoff.ts";
import type { AnalysisObservationBoundary, loadAnalysisBars } from "../../runtime/analysis-data.ts";
import { err } from "./results.ts";

export const HistoricalPriceFields = {
  market: ["A", "US", "HK"] as const,
  source: ["auto", "akshare", "tushare", "llmquant-data", "financial-datasets"] as const,
};

export interface PriceAnalysisArgs {
  symbol: string;
  start?: string;
  end?: string;
  market?: Market;
  source?: DataSource;
  observed_before?: string;
}

export interface PriceArchiveRequest {
  symbol: string;
  market: Market;
  source: DataSource | "configured source";
  start: string;
  end: string;
  observedBefore: string;
}

type Prepared = { cached: BarsFetchResult; archiveRequest?: PriceArchiveRequest } | { error: AgentToolResult<unknown> };

/** An explicit UTC cutoff cannot fall back to a current provider or an unbound host data port. */
export async function preparePriceAnalysisBars(loadCurrent: typeof loadAnalysisBars,
  loadArchive: typeof loadAnalysisBars | null, args: PriceAnalysisArgs, minimum: number, signal?: AbortSignal): Promise<Prepared> {
  signal?.throwIfAborted();
  if (args.observed_before === undefined) {
    if (args.source !== undefined)
      return { error: err("INPUT_INVALID_ANALYSIS_PARAMETERS", "source is only used with observed_before; current analysis uses the configured source.") };
    if (args.market !== undefined) {
      try { normalizeSymbol(args.symbol, args.market); }
      catch { return { error: err("INPUT_INVALID_ANALYSIS_PARAMETERS", "Current analysis symbol/market identity is invalid.") }; }
    }
    return { cached: await loadCurrent(args.symbol, minimum, args.start, args.end, signal) };
  }
  try { validateObservationCutoff(args.observed_before); }
  catch { return { error: err("DATA_INVALID_OBSERVATION_CUTOFF") }; }
  if (!args.market || !HistoricalPriceFields.market.includes(args.market) || !args.start || !args.end
    || args.source !== undefined && !HistoricalPriceFields.source.includes(args.source))
    return { error: err("INPUT_INVALID_ANALYSIS_PARAMETERS", "Historical analysis requires market, start/end and a valid optional source.") };
  let canonicalSymbol: string;
  try { validateDateRange(args.start, args.end); canonicalSymbol = normalizeSymbol(args.symbol, args.market); }
  catch { return { error: err("INPUT_INVALID_ANALYSIS_PARAMETERS", "Historical symbol/market or price dates are invalid.") }; }
  if (!loadArchive) return { error: err("DATA_ARCHIVE_PORT_UNAVAILABLE") };
  const boundary: AnalysisObservationBoundary = { market: args.market, source: args.source, observedBefore: args.observed_before };
  let cached: BarsFetchResult;
  try { cached = await loadArchive(args.symbol, minimum, args.start, args.end, signal, boundary); }
  catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.message.includes("archive unavailable"))
      return { error: err("DATA_ASOF_ARCHIVE_UNAVAILABLE") };
    throw error;
  }
  signal?.throwIfAborted();
  if (!cached.bars.length) return { error: err("DATA_NO_ASOF_ARCHIVE") };
  const ref = cached.dataset;
  let observedAt: number;
  try { observedAt = validateObservationCutoff(ref?.snapshotAt ?? ""); }
  catch { return { error: err("DATA_ASOF_ARCHIVE_UNAVAILABLE", "Archive result has no exact UTC observation time.") } };
  if (!ref || ref.symbol !== canonicalSymbol || ref.market !== args.market || ref.requested.start !== args.start
    || ref.requested.end !== args.end || observedAt > validateObservationCutoff(args.observed_before)
    || cached.observationAt !== ref.snapshotAt || cached.historicalBoundary?.evidence !== "app-archive"
    || cached.historicalBoundary.observedBefore !== args.observed_before)
    return { error: err("DATA_ASOF_ARCHIVE_UNAVAILABLE", "Archive result does not match the requested observation boundary.") };
  return { cached, archiveRequest: { symbol: args.symbol, market: args.market, source: args.source ?? "configured source",
    start: args.start, end: args.end, observedBefore: args.observed_before } };
}
