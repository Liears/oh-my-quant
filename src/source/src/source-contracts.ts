import type { Bar, CachedBars, DatasetRef, Market, PriceAdjustment } from "../../types/data.ts";
import type { FinancialDatasetsOptions } from "./financial-datasets.ts";
import type { LlmQuantOptions } from "./llmquant.ts";
import type { TushareOptions } from "./tushare.ts";
import type { AkshareBarsOptions } from "./akshare-types.ts";

export type DataSource = "auto" | "akshare" | "tushare" | "llmquant-data" | "financial-datasets";

/** Provider id returned by live pull (not cache). */
export type PullSource = "akshare" | "tushare" | "llmquant-data" | "financial-datasets" | "unavailable";
export type ProviderSource = Exclude<PullSource, "unavailable">;

export interface SourceBarsRequest {
  signal?: AbortSignal;
  symbol: string;
  market: Market;
  start?: string;
  end?: string;
}

/** Replaceable boundary between source orchestration and a concrete data client. */
export interface BarProviderAdapter {
  fetchBars(request: SourceBarsRequest): Promise<Bar[] | { bars: Bar[]; endpoint: string | null; adjustment?: PriceAdjustment }>;
}

export interface ProviderAttempt {
  source: ProviderSource;
  status: "success" | "empty" | "error";
  /** Redacted, one-line diagnostic. The orchestrator never throws provider failures. */
  error?: string;
  /** Concrete endpoint on a successful response, when the adapter can identify it. */
  providerEndpoint?: string;
}

export interface PullBarsResult {
  bars: Bar[];
  adjustment?: PriceAdjustment;
  source: PullSource;
  attempts: ProviderAttempt[];
  providerEndpoint?: string;
  /** The shared provider-chain deadline expired; late adapter rows were discarded. */
  budgetExhausted?: boolean;
}

export interface LiveFetchResult {
  bars: Bar[];
  adjustment?: PriceAdjustment;
  source: PullSource;
  /** Latest bar date from provider, e.g. 2026-06-08. */
  asOfDate: string;
}

/** Live quote pulls keep window fallback and provider diagnostics separate from cache origins. */
export interface LiveBarsFetchResult extends LiveFetchResult {
  attempts: ProviderAttempt[];
  window: "requested" | "latest-available" | "unavailable";
  providerEndpoint?: string;
  budgetExhausted?: boolean;
}

export interface SourceRuntimeDeps {
  loadCache(symbol: string, source: string, start?: string, end?: string, signal?: AbortSignal): Promise<CachedBars>;
  /** Optional immutable app-observation history. Never contacts a provider. */
  loadArchiveBefore?(
    symbol: string, source: string, start: string | undefined, end: string | undefined, observedBefore: string, signal?: AbortSignal,
  ): Promise<CachedBars>;
  saveBars(symbol: string, source: string, bars: Bar[], start?: string, end?: string, signal?: AbortSignal, providerEndpoint?: string, adjustment?: PriceAdjustment): Promise<DatasetRef | null | void>;
  getPreferredSource(market: Market, signal?: AbortSignal): DataSource | Promise<DataSource>;
}

export interface BarsFetchResult extends LiveFetchResult {
  origin: "provider" | "cache" | "stale-cache" | "unavailable";
  attempts: ProviderAttempt[];
  budgetExhausted?: boolean;
  dataset?: DatasetRef;
  providerEndpoint?: string;
  /** Old cache snapshots did not record whether amount=0 was provider-reported. */
  turnoverSemantics?: "nullable" | "legacy-unknown";
  /** Application observation instant; distinct from asOfDate, the latest price date. */
  observationAt?: string;
  historicalBoundary?: { observedBefore: string; evidence: "app-archive" | "unavailable" };
}

export interface SourceProviderOptions {
  signal?: AbortSignal;
  /** Monotonic request deadline: fetchBars also applies it to cache and save; live window retries share it. */
  budgetMs?: number;
  /** Host-owned credentials are read only if a concrete paid adapter is dispatched. */
  loadCredentials?: (signal?: AbortSignal) => Pick<SourceProviderOptions, "akshare" | "tushare" | "llmquant" | "financialDatasets">
    | Promise<Pick<SourceProviderOptions, "akshare" | "tushare" | "llmquant" | "financialDatasets">>;
  akshare?: AkshareBarsOptions;
  tushare?: TushareOptions;
  llmquant?: LlmQuantOptions;
  financialDatasets?: FinancialDatasetsOptions;
  /** Per-call adapter overrides, useful for replacing an unavailable provider. */
  adapters?: Partial<Record<ProviderSource, BarProviderAdapter>>;
  /** Optional fallback chain override per market. The selected source is still tried first. */
  fallbackOrder?: Partial<Record<Market, readonly ProviderSource[]>>;
}

export interface SourceFetchOptions {
  deps?: SourceRuntimeDeps;
  providers?: SourceProviderOptions;
  /** Opt-in archive-only UTC boundary; live providers and current cache heads are forbidden. */
  observedBefore?: string;
}

export const SOURCE_LABELS: Record<PullSource, string> = {
  akshare: "AKShare",
  tushare: "Tushare",
  "llmquant-data": "LLMQuant",
  "financial-datasets": "Financial Datasets",
  unavailable: "暂无数据",
};
