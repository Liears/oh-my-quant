import type { FundNavDaily } from "../../types/data.ts";
import type { AksharePublicFundEndpoint, AksharePublicIndexEndpoint } from "./akshare-endpoints.ts";

export type AkshareIndexConstituentEndpoint =
  | "index_stock_cons_csindex"
  | "index_stock_cons_sina"
  | "index_stock_cons";

export interface AkshareIndexRowsResult {
  endpoint: AksharePublicIndexEndpoint;
  params: Record<string, unknown>;
  fetchedAt: string;
  rowCount: number;
  rows: Record<string, unknown>[];
}

export interface AkshareIndexInfoRow {
  indexCode: string;
  displayName: string;
  publishDate: string | null;
}

export interface AkshareIndexInfoResult {
  fetchedAt: string;
  rowCount: number;
  rows: AkshareIndexInfoRow[];
}

export interface AkshareIndexQuote {
  code: string;
  name: string;
  price: number;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  amount: number | null;
  category?: string;
  source: "akshare";
}

export interface AkshareIndexConstituent {
  stockCode: string;
  stockName: string;
  inclusionDate: string | null;
  indexCode: string;
  indexName: string | null;
  exchange: string | null;
  weight: number | null;
  source: AkshareIndexConstituentEndpoint;
}

export interface AkshareIndexConstituentsResult {
  symbol: string;
  indexName: string | null;
  fetchedAt: string;
  source: AkshareIndexConstituentEndpoint | null;
  constituents: AkshareIndexConstituent[];
  attempts: AkshareAttempt[];
}

export interface AkshareArtifactReferenceLine {
  label: string;
  symbol: string;
  dates: string[];
  closes: number[];
  source: "akshare";
}

export interface AkshareAttempt {
  endpoint: string;
  status: "ok" | "error";
  rows?: number;
  error?: string;
}

export type { FundNavDaily } from "../../types/data.ts";

export interface FundAchievementRow {
  type: string;
  period: string;
  returnPct: number | null;
  maxDrawdownPct: number | null;
  rank: string | null;
}

export interface FundRiskAnalysisRow {
  period: string;
  riskReturnScore: number | null;
  antiVolatilityScore: number | null;
  annualVolatilityPct: number | null;
  annualSharpe: number | null;
  maxDrawdownPct: number | null;
}

export interface AkshareFundHistory {
  symbol: string;
  fetchedAt: string;
  nav: FundNavDaily[];
  profile: Record<string, unknown>;
  rank: Record<string, unknown>;
  purchase: Record<string, unknown>;
  achievement: FundAchievementRow[];
  analysis: FundRiskAnalysisRow[];
  attempts: AkshareAttempt[];
}

export interface AkshareRowsResult {
  endpoint: AksharePublicFundEndpoint;
  params: Record<string, unknown>;
  fetchedAt: string;
  rowCount: number;
  rows: Record<string, unknown>[];
}
