import {
  fetchBars as fetchSourceBars,
  fetchLiveBars as fetchSourceLiveBars,
  type DataSource,
  type LiveFetchResult,
  type SourceFetchOptions,
  type SourceRuntimeDeps,
} from "../source/index.ts";
import { isCacheFresh, loadBars, loadSettings, saveBars } from "../storage/index.ts";
import type { Bar, Market } from "../types/data.ts";

export function createStorageSourceRuntimeDeps(): SourceRuntimeDeps {
  return {
    loadBars,
    saveBars,
    isCacheFresh,
    getPreferredSource: () => loadSettings().preferences.source,
  };
}

export async function fetchBars(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  source?: DataSource,
  options: SourceFetchOptions = {},
): Promise<{ bars: Bar[]; source: string }> {
  return fetchSourceBars(symbol, market, start, end, source, withStorageDeps(options));
}

export async function fetchLiveBars(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  options: Pick<SourceFetchOptions, "deps" | "providers"> = {},
): Promise<LiveFetchResult> {
  return fetchSourceLiveBars(symbol, market, start, end, withStorageDeps(options));
}

function withStorageDeps<T extends Pick<SourceFetchOptions, "deps" | "providers">>(options: T): T & { deps: SourceRuntimeDeps } {
  return {
    ...options,
    deps: options.deps ?? createStorageSourceRuntimeDeps(),
  };
}
