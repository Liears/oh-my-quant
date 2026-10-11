import type { Bar, DatasetRef } from "../types/data.ts";
import type { FundNavDaily } from "../types/data.ts";
import type { FundNavDatasetRef, FundFeeObservation } from "../types/fund-data.ts";

/** Generated from whitelisted public observations, never from narrative or arbitrary tool output. */
export interface ResearchBarsDataset {
  ref: DatasetRef;
  bars: Bar[];
}

export interface ResearchFundDataset {
  ref: FundNavDatasetRef;
  nav: FundNavDaily[];
  fee: FundFeeObservation | null;
}

export type ResearchDataset = ResearchBarsDataset | ResearchFundDataset;

export interface ResearchMetric {
  label: string;
  value: number | null;
  unit: "percent" | "number" | "periods";
}

export interface ResearchAnalysis {
  kind: "factor" | "risk" | "backtest" | "benchmark" | "fund-dca" | "dashboard" | "portfolio-comparison" | "alpha-backtest";
  title: string;
  datasetIndexes: number[];
  metrics: ResearchMetric[];
  assumptions: string[];
  /** Benchmarks in every verified dashboard row, including rows beyond the displayed top ten. */
  benchmarkSymbols?: string[];
  ranking?: Array<{ title: string; basis: string; datasetIndexes: number[]; score: number; cagr: number | null; sharpe: number | null; maxDrawdown: number | null }>;
  /** Unit initial value; no cash balances, quantities or trade amounts. */
  curve?: { dates: string[]; values: number[]; benchmark?: number[]; basis?: "cash-flow-adjusted" };
  comparison?: ResearchComparison;
}

/** Deliberately excludes private group names, IDs, revision, request text and arbitrary source metadata. */
export interface ResearchComparison {
  dates: string[];
  series: Array<{
    label: string;
    values: number[];
    metrics: ResearchMetric[];
    members: Array<{ symbol: string; currency: string; initialWeight: number; localReturn: number; baseReturn: number }>;
  }>;
  excluded: Array<{ portfolio: string; symbol: string }>;
  droppedDates: Array<{ date: string; missing: string[] }>;
  fx: { source: "identity" | "frankfurter-v2/ecb"; observedAt: string; baseCurrency: string; points: Array<{ currency: string; date: string; rate: number }> };
}

export interface ResearchReport {
  version: 1;
  /** Internal evidence provenance, separate from the public analysis DTO. */
  bindings: Array<{ analysisIndex: number; toolName: string; toolCallId: string; callEntryId: string | null; resultEntryId: string | null }>;
  datasets: ResearchDataset[];
  analyses: ResearchAnalysis[];
  exclusions: { unavailableInputs: number; unverifiedResults: number; unsupportedResults: number };
}
