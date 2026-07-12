import type { Bar, Market } from "../../types/data.ts";
import type { FinancialDatasetsOptions } from "./financial-datasets.ts";
import type { LlmQuantOptions } from "./llmquant.ts";
import type { TushareOptions } from "./tushare.ts";
import type { AkshareBarsOptions } from "./akshare-types.ts";

export type DataSource = "auto" | "akshare" | "tushare" | "llmquant-data" | "financial-datasets";

/** Provider id returned by live pull (not cache). */
export type PullSource = "akshare" | "tushare" | "llmquant-data" | "financial-datasets" | "unavailable";
export type ProviderSource = Exclude<PullSource, "unavailable">;

export interface SourceBarsRequest {
  symbol: string;
  market: Market;
  start?: string;
  end?: string;
}

/** Replaceable boundary between source orchestration and a concrete data client. */
export interface BarProviderAdapter {
  fetchBars(request: SourceBarsRequest): Promise<Bar[]>;
}

export interface ProviderAttempt {
  source: ProviderSource;
  status: "success" | "empty" | "error";
  /** Redacted, one-line diagnostic. The orchestrator never throws provider failures. */
  error?: string;
}

export interface PullBarsResult {
  bars: Bar[];
  source: PullSource;
  attempts: ProviderAttempt[];
}

export interface LiveFetchResult {
  bars: Bar[];
  source: PullSource;
  /** Latest bar date from provider, e.g. 2026-06-08. */
  asOfDate: string;
}

export interface SourceRuntimeDeps {
  loadBars(symbol: string, source: string): Promise<Bar[]>;
  saveBars(symbol: string, source: string, bars: Bar[]): Promise<void> | void;
  isCacheFresh(symbol: string, source: string): Promise<boolean> | boolean;
  getPreferredSource(market: Market): DataSource;
}

export interface SourceProviderOptions {
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
}

export const SOURCE_LABELS: Record<PullSource, string> = {
  akshare: "AKShare",
  tushare: "Tushare",
  "llmquant-data": "LLMQuant",
  "financial-datasets": "Financial Datasets",
  unavailable: "暂无数据",
};
