import type { Bar, DatasetRef } from "./data.ts";

export type AlphaSpec =
  | { kind: "sma"; fast: number; slow: number; quantity: number }
  | { kind: "signals"; values: (0 | 1)[]; quantity: number };

export interface AlphaBacktestRequest {
  version: 1;
  symbol: string;
  bars: Bar[];
  dataset?: DatasetRef;
  strategy: AlphaSpec;
  initialCash: number;
  costs: { commissionRate: number; slippageRate: number };
  periodsPerYear: number;
  simulation: "generic-stock-next-open";
}

export interface AlphaFill {
  id: string;
  orderId: string;
  date: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  commission: number;
}

export interface AlphaOrder {
  id: string;
  createdDate: string;
  side: "buy" | "sell";
  quantity: number;
  filledQuantity: number;
  status: "filled" | "cancelled" | "rejected";
}

export interface AlphaBacktestResult {
  version: 1;
  engine: { name: "akquant"; version: string; ruleVersion: string; python: string };
  inputHash: string;
  request: AlphaBacktestRequest;
  curve: { date: string; equity: number; cash: number; quantity: number }[];
  fills: AlphaFill[];
  orders: AlphaOrder[];
  metrics: {
    totalReturn: number; cagr: number; annualVol: number; sharpe: number | null;
    maxDrawdown: number; maxDrawdownPeriods: number;
  };
}

/** User-facing research assumptions, independent of provider and Python configuration. */
export interface AlphaResearchRequest {
  symbol: string;
  start: string;
  end: string;
  fast: number;
  slow: number;
  quantity: number;
  cash: number;
  commission: number;
  slippage: number;
  periods_per_year: number;
  simulation: "generic-stock-next-open";
}

export interface AlphaRunArtifact {
  version: 1;
  kind: "alpha-backtest";
  id: string;
  createdAt: string;
  origin: "provider" | "cache" | "stale-cache";
  request: AlphaResearchRequest;
  result: AlphaBacktestResult;
}

export interface AlphaEngineStatus {
  status: "ready" | "not-configured" | "unavailable" | "version" | "timeout" | "cancelled" | "process" | "output";
  requiredVersion: string;
  python?: string;
  version?: string;
  ruleVersion?: string;
}
