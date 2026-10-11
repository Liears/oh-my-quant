import type { FundNavDaily } from "./data.ts";

export const FUND_NAV_ENDPOINTS = ["fund_open_fund_info_em", "fund_etf_fund_info_em", "fund_graded_fund_info_em", "fund_financial_fund_info_em"] as const;
export type FundNavEndpoint = typeof FUND_NAV_ENDPOINTS[number];

/** Public current fee observation, never an account or a historical fee schedule. */
export interface FundFeeObservation {
  source: "fund_purchase_em";
  fetchedAt: string;
  rate: number | null;
}

export interface FundNavDatasetRef {
  version: 1;
  kind: "fund-nav";
  symbol: string;
  market: "A";
  source: "akshare";
  endpoint: FundNavEndpoint;
  revision: string;
  contentHash: string;
  dates: string[];
  requested: { start: string | null; end: string | null };
  snapshotAt: string;
  adjustment: "unit-nav-unadjusted";
  availability: "observed-at-fetch";
}

export interface FundNavSnapshot {
  version: 1;
  symbol: string;
  source: "akshare";
  endpoint: FundNavEndpoint;
  fetchedAt: string;
  nav: FundNavDaily[];
  fee: FundFeeObservation | null;
  revision: string;
}
