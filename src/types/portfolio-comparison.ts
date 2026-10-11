import type { DatasetRef } from "./data.ts";
import type { FundNavDatasetRef } from "./fund-data.ts";
import type { RiskMetrics } from "./risk.ts";

export interface ComparisonPrice {
  symbol: string;
  currency: string;
  points: { date: string; price: number }[];
  source: string;
  observedAt: string;
  origin: string;
  unavailableReason?: string;
  dataset?: DatasetRef | FundNavDatasetRef;
}

export interface ComparisonFx {
  baseCurrency: string;
  /** Base-currency units per one unit of the member's quote currency. */
  points: { currency: string; date: string; rate: number }[];
  source: string;
  observedAt: string;
}

export interface ComparisonGroup {
  id: string;
  name: string;
  members: string[];
  /** Absent means equal initial allocations; otherwise positive fractions summing to 1. */
  weights?: Record<string, number>;
}

export interface PortfolioComparisonRequest {
  groups: [string, string];
  start: string;
  end: string;
  benchmark: string;
  baseCurrency: string;
  currencies: Record<string, string>;
  weighting: "buy-and-hold" | "rebalance";
  missingMembers: "fail" | "exclude";
  weights?: [Record<string, number> | null | undefined, Record<string, number> | null | undefined];
}

export interface PortfolioComparisonInput {
  /** Original selectors and assumptions, captured before canonicalization; absent in older research. */
  request?: PortfolioComparisonRequest;
  groups: [ComparisonGroup, ComparisonGroup];
  benchmark: string;
  start: string;
  end: string;
  baseCurrency: string;
  weighting: "buy-and-hold" | "rebalance";
  missingMembers: "fail" | "exclude";
  prices: ComparisonPrice[];
  fx: ComparisonFx;
  /** Captures the observation-group configuration; never actual account positions. */
  portfolioRevision: string;
}

export interface ComparisonCurve {
  id: string;
  name: string;
  members: { symbol: string; currency: string; initialWeight: number; localReturn: number; baseReturn: number }[];
  nav: { date: string; value: number }[];
  totalReturn: number;
  cagr: number | null;
  sharpe: number | null;
  maxDrawdown: number;
  risk: RiskMetrics | null;
  excessReturn: number;
}

export interface PortfolioComparisonResult {
  /** Version 2 corrects weighting explanations; version 1 arithmetic and archived bytes remain verifiable. */
  methodVersion: 1 | 2;
  input: PortfolioComparisonInput;
  dates: string[];
  excludedMembers: { groupId: string; symbol: string; reason: string }[];
  droppedDates: { date: string; missing: string[] }[];
  groups: [ComparisonCurve, ComparisonCurve];
  benchmark: ComparisonCurve;
  assumptions: {
    currencyBasis: "explicit-research-assumption";
    fxAlignment: "same-date-only";
    priceBasis: "provider-close-or-unit-nav";
    periodicity: "common-observation-intervals";
    periodsPerYear: number;
    elapsedYears: number;
    costs: 0;
    fractionalShares: true;
    warning: string;
  };
}

export interface PortfolioComparisonArtifact {
  version: 1;
  kind: "portfolio-comparison";
  id: string;
  createdAt: string;
  result: PortfolioComparisonResult;
}
