import {
  fetchBars as fetchSourceBars,
  fetchLiveBars as fetchSourceLiveBars,
  fetchResearchBars as fetchSourceResearchBars,
  searchSymbols as searchSourceSymbols,
  type BarsFetchResult,
  type DataSource,
  type LiveBarsFetchResult,
  type SourceFetchOptions,
  type SourceProviderOptions,
  type SourceRuntimeDeps,
} from "../../source/index.ts";
import { loadArchivedBarsBefore, loadCachedBars, loadSettings, readSettingsAsync, saveBars } from "../../storage/index.ts";
import type { Market } from "../../types/data.ts";
import type { SymbolInfo } from "../../types/data.ts";
import type { OhQuantSettings } from "../../types/config.ts";

const REGULAR_SOURCE_REQUEST_BUDGET_MS = 60_000;

export function createStorageSourceRuntimeDeps(): SourceRuntimeDeps {
  return {
    loadCache: loadCachedBars,
    loadArchiveBefore: loadArchivedBarsBefore,
    saveBars,
    getPreferredSource: async (_market, signal) => (await readSettingsAsync(signal)).preferences.source,
  };
}

/** Pass settings-backed credentials to providers so /config changes work immediately. */
export function createStorageSourceProviderOptions(settings: OhQuantSettings = loadSettings()): SourceProviderOptions {
  const env = { ...process.env, ...settings.env };
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
): Promise<BarsFetchResult> {
  // An archive-only query has no provider dependency. Avoid preparing credentials
  // or reading provider settings before its local revision lookup.
  const bound = options.observedBefore === undefined ? withStorageDeps(options, REGULAR_SOURCE_REQUEST_BUDGET_MS)
    : { ...options, deps: options.deps ?? createStorageSourceRuntimeDeps() };
  return fetchSourceBars(symbol, market, start, end, source, bound);
}

export async function createStorageSourceProviderOptionsAsync(signal?: AbortSignal): Promise<SourceProviderOptions> {
  return createStorageSourceProviderOptions(await readSettingsAsync(signal));
}

export async function fetchLiveBars(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  options: Pick<SourceFetchOptions, "deps" | "providers"> = {},
): Promise<LiveBarsFetchResult> {
  return fetchSourceLiveBars(symbol, market, start, end, withStorageDeps(options, REGULAR_SOURCE_REQUEST_BUDGET_MS));
}

export async function searchSymbols(keyword: string, market?: Market, signal?: AbortSignal): Promise<SymbolInfo[]> {
  signal?.throwIfAborted();
  return searchSourceSymbols(keyword, market, { loadCredentials: createStorageSourceProviderOptionsAsync,
    signal, budgetMs: REGULAR_SOURCE_REQUEST_BUDGET_MS });
}

/** Research callers receive atomic provenance; no cache fetch time is relabeled as live evidence. */
export async function fetchResearchBars(
  symbol: string, market: Market, start?: string, end?: string, source?: DataSource,
  options: SourceProviderOptions = {},
) {
  return fetchSourceResearchBars(symbol, market, start, end,
    source ?? (await readSettingsAsync(options.signal)).preferences.source,
    withStorageDeps({ providers: options }, REGULAR_SOURCE_REQUEST_BUDGET_MS).providers);
}

function withStorageDeps<T extends Pick<SourceFetchOptions, "deps" | "providers">>(options: T, defaultBudgetMs?: number): T & { deps: SourceRuntimeDeps } {
  const requestedBudget = options.providers?.budgetMs;
  const budgetMs = requestedBudget !== undefined && defaultBudgetMs !== undefined
    && Number.isSafeInteger(requestedBudget) && requestedBudget <= 2_147_483_647
    ? Math.min(requestedBudget, defaultBudgetMs) : requestedBudget ?? defaultBudgetMs;
  return {
    ...options,
    deps: options.deps ?? createStorageSourceRuntimeDeps(),
    providers: { ...options.providers, budgetMs,
      loadCredentials: options.providers?.loadCredentials ?? createStorageSourceProviderOptionsAsync },
  };
}
