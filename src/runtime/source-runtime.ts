import {
  fetchBars as fetchSourceBars,
  fetchLiveBars as fetchSourceLiveBars,
  fetchResearchBars as fetchSourceResearchBars,
  searchSymbols as searchSourceSymbols,
  type DataSource,
  type LiveFetchResult,
  type SourceFetchOptions,
  type SourceProviderOptions,
  type SourceRuntimeDeps,
} from "../source/index.ts";
import { isCacheFresh, loadBars, loadSettings, saveBars } from "../storage/index.ts";
import type { Bar, Market } from "../types/data.ts";
import type { SymbolInfo } from "../types/data.ts";

export function createStorageSourceRuntimeDeps(): SourceRuntimeDeps {
  return {
    loadBars,
    saveBars,
    isCacheFresh,
    getPreferredSource: () => loadSettings().preferences.source,
  };
}

/** Pass settings-backed credentials to providers so /config changes work immediately. */
export function createStorageSourceProviderOptions(): SourceProviderOptions {
  const env = loadSettings().env;
  return {
    tushare: { token: env.WHYJ_QUANT_TUSHARE_TOKEN, baseUrl: env.TUSHARE_BASE_URL, env },
    llmquant: { apiKey: env.WHYJ_QUANT_LLMQUANT_API_KEY, baseUrl: env.LLMQUANT_BASE_URL, env },
    financialDatasets: { apiKey: env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY, baseUrl: env.FINANCIAL_DATASETS_BASE_URL, env },
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

export async function searchSymbols(keyword: string, market?: Market): Promise<SymbolInfo[]> {
  return searchSourceSymbols(keyword, market, createStorageSourceProviderOptions());
}

/** Research callers receive atomic provenance; no cache fetch time is relabeled as live evidence. */
export async function fetchResearchBars(
  symbol: string, market: Market, start?: string, end?: string, source?: DataSource,
  options: SourceProviderOptions = {},
) {
  return fetchSourceResearchBars(symbol, market, start, end,
    source ?? loadSettings().preferences.source, { ...createStorageSourceProviderOptions(), ...options });
}

function withStorageDeps<T extends Pick<SourceFetchOptions, "deps" | "providers">>(options: T): T & { deps: SourceRuntimeDeps } {
  return {
    ...options,
    deps: options.deps ?? createStorageSourceRuntimeDeps(),
    providers: { ...createStorageSourceProviderOptions(), ...options.providers },
  };
}
