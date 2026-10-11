import { validateDateRange } from "../market/bars.ts";
import { validateObservationCutoff } from "../market/observation-cutoff.ts";
import { fetchBars } from "./source-runtime.ts";
import type { DataSource } from "../source/index.ts";
import type { Market } from "../types/data.ts";
import type { loadAnalysisBars } from "./analysis-data.ts";

export interface ArchiveAnalysisRequest {
  symbol: string;
  market: Market;
  source?: DataSource;
  start: string;
  end: string;
  observedBefore: string;
}

export class MissingArchiveAnalysisData extends Error {
  constructor() { super("No complete application-observed response covers this analysis window before the cutoff."); }
}

/** Bind one immutable observation boundary to the existing price computation port. */
export function createArchiveAnalysisBarsLoader(request: ArchiveAnalysisRequest): typeof loadAnalysisBars {
  validateDateRange(request.start, request.end);
  validateObservationCutoff(request.observedBefore);
  return async (symbol, _minimum, start, end, signal) => {
    signal?.throwIfAborted();
    if (symbol !== request.symbol || start !== request.start || end !== request.end)
      throw new Error("Archived analysis inputs changed after the observation boundary was bound.");
    const result = await fetchBars(symbol, request.market, start, end, request.source, {
      observedBefore: request.observedBefore, providers: { signal },
    });
    signal?.throwIfAborted();
    if (result.historicalBoundary?.evidence !== "app-archive" || result.historicalBoundary.observedBefore !== request.observedBefore
      || !result.dataset || result.bars.length === 0) throw new MissingArchiveAnalysisData();
    return result;
  };
}
