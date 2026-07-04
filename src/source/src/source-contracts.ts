import type { Bar, Market } from "../../types/data.ts";
import type { FinancialDatasetsOptions } from "./financial-datasets.ts";
import type { LlmQuantOptions } from "./llmquant.ts";
import type { TushareOptions } from "./tushare.ts";

export type DataSource = "auto" | "akshare" | "tushare" | "llmquant-data" | "financial-datasets";

/** Provider id returned by live pull (not cache). */
export type PullSource = "akshare" | "tushare" | "llmquant-data" | "financial-datasets" | "unavailable";
export type ProviderSource = Exclude<PullSource, "unavailable">;

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
  tushare?: TushareOptions;
  llmquant?: LlmQuantOptions;
  financialDatasets?: FinancialDatasetsOptions;
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
