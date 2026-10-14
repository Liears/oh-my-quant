/** Private, transient account data. Never an Agent tool result or public research/cache DTO. */
export interface AccountPerformanceRequest {
  accountRef: string;
  currency: string;
  /** UTC epoch milliseconds; flows/fees cover (startAt, endAt]. */
  startAt: number;
  endAt: number;
}
export interface AccountHistory {
  version: 1;
  request: AccountPerformanceRequest;
  source: { adapterId: string; reference: string; observedAt: number };
  coverage: { externalFlows: "complete" | "incomplete" | "unknown"; fees: "complete" | "incomplete" | "unknown" };
  /** All reported fees are already deducted from account equity. */
  equityBasis: "after-fees";
  /** Ordered boundary valuations and every external-flow instant, immediately BEFORE that instant's flows. */
  valuations: Array<{ at: number; equityBeforeFlow: number }>;
  /** Positive into the account, negative out; excludes trades, retained income and fee debits. */
  externalFlows: Array<{ id: string; at: number; amount: number }>;
  /** Complete interval fee ledger, in request.currency; disclose, never subtract twice. */
  fees: Array<{ id: string; at: number; amount: number }>;
}
export interface AccountHistoryAdapter {
  readonly id: string;
  readonly accountRef: string;
  /** Adapter owns authentication, complete pagination, currency conversion and valuation provenance. */
  readHistory(request: AccountPerformanceRequest, signal: AbortSignal): Promise<AccountHistory>;
}
export interface AccountPerformance {
  visibility: "private-live-only";
  method: "flow-valuations-twr-v1";
  verification: "input-consistency-only";
  request: AccountPerformanceRequest;
  source: AccountHistory["source"];
  openingEquity: number;
  closingEquity: number;
  netExternalFlow: number;
  netProfit: number;
  feesAlreadyDeducted: number;
  timeWeightedReturn: number;
  observedMaxDrawdown: number;
  points: Array<{ at: number; unitEquity: number; periodReturn: number | null }>;
  limitations: string[];
}
