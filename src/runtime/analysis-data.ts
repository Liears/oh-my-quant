import { fetchBars } from "./source-runtime.ts";
import { inferMarket } from "../market/symbols.ts";
import { validateDateRange } from "../market/bars.ts";
import { normalizeSymbol } from "../market/symbols.ts";
import { validateObservationCutoff } from "../market/observation-cutoff.ts";
import type { DataSource } from "../source/index.ts";
import type { Market } from "../types/data.ts";

export interface AnalysisObservationBoundary {
  market: Market;
  source?: DataSource;
  observedBefore: string;
}

/** One automatic data path for all price-based analysis tools. */
export async function loadAnalysisBars(symbol: string, minimum: number, start?: string, end?: string,
  signal?: AbortSignal, boundary?: AnalysisObservationBoundary) {
  signal?.throwIfAborted();
  validateDateRange(start, end);
  if (boundary) {
    if (!start || !end) throw new Error("An observation cutoff requires an explicit price window.");
    validateObservationCutoff(boundary.observedBefore);
    normalizeSymbol(symbol, boundary.market);
    return fetchBars(symbol, boundary.market, start, end, boundary.source, {
      observedBefore: boundary.observedBefore, providers: { signal },
    });
  }
  const until = end ? new Date(`${end}T00:00:00Z`) : new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - Math.max(365, minimum * 3));
  const result = await fetchBars(symbol, inferMarket(symbol), start ?? since.toISOString().slice(0, 10), end, undefined, { providers: { signal } });
  if (result.origin === "unavailable" && result.attempts.some(attempt => attempt.status === "error")) {
    throw new Error(`Could not prepare ${symbol} data: ${result.attempts.map(attempt => `${attempt.source}: ${attempt.error ?? attempt.status}`).join("; ")}`);
  }
  return result;
}

export function validateBacktestParameters(fast: number, slow: number, cash: number): void {
  if (!Number.isInteger(fast) || fast < 1 || !Number.isInteger(slow) || slow <= fast) {
    throw new Error("SMA periods must be positive integers with fast < slow.");
  }
  if (!Number.isFinite(cash) || cash <= 0) throw new Error("Initial cash must be positive.");
}
