import type { Bar, Market } from "./data.ts";

export type AdjustmentBasis = "raw" | "qfq" | "hfq" | "unknown";
export interface DatedEvidence {
  source: string;
  verifiedAt: string;
}

/** Evidence describes the source's statement, not inferred wall-clock completion. */
export interface DailyBarDataset {
  symbol: string;
  market: Market;
  source: string;
  fetchedAt: string;
  marketAt: string | null;
  units: { volume: "shares" | "lots" | "units" | "unknown"; amount: "CNY" | "unknown" };
  adjustment: DatedEvidence & { basis: AdjustmentBasis };
  finality: Record<string, DatedEvidence & { status: "final" | "partial" | "unknown" }>;
  bars: Bar[];
}

/** Supplied exchange-calendar evidence; this contract does not fetch a calendar. */
export interface ResearchContext {
  asOf: string; // ISO 8601 with Asia/Shanghai +08:00
  calendar: DatedEvidence & {
    sessions: string[];
    lastCompletedSession: string;
  };
}

export interface CompletedBarSelection {
  status: "ready" | "data_insufficient";
  bars: Bar[];
  excluded: Array<{ date: string; reason: string }>;
  issues: string[];
}
