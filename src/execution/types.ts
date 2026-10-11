/** Private execution state. These contracts are not Agent messages or public market-data DTOs. */
export interface ExecutionTarget { adapterId: string; accountRef: string; mode: "paper" | "live" }
export interface ExecutionInstrument { symbol: string; venue: string; currency: string }
export interface Money { currency: string; amount: string }
export interface OrderIntent {
  version: 1;
  target: ExecutionTarget;
  clientOrderId: string;
  instrument: ExecutionInstrument;
  side: "buy" | "sell";
  type: "limit";
  quantity: string;
  limitPrice: string;
  /** Limit-price valuation cap, excluding fees; not an upper bound on a sell's execution proceeds. */
  maxOrderNotional: string;
  timeInForce: "day" | "gtc" | "ioc";
}
export interface PreparedOrder { intent: OrderIntent; intentHash: string }
export interface OrderReference { clientOrderId: string; intentHash: string }
export type OrderStatus = "accepted" | "open" | "partially-filled" | "filled" | "cancelled" | "rejected" | "expired";
/** Null means the provider did not report an attributable per-fill fee; it is never interpreted as zero. */
export interface Fill { id: string; quantity: string; price: string; fee: Money | null; at: number }
export interface OrderSnapshot extends OrderReference {
  target: ExecutionTarget;
  orderId: string;
  status: OrderStatus;
  quantity: string;
  filledQuantity: string;
  /** Complete fills belonging to this snapshot, not one page of a provider response. */
  fills: Fill[];
  observedAt: number;
}
export interface AccountSnapshot {
  target: ExecutionTarget;
  observedAt: number;
  balances: Array<{ currency: string; cash: string; availableCash: string }>;
  positions: Array<{ instrument: ExecutionInstrument; quantity: string; availableQuantity: string }>;
}
export type PreflightResult =
  | { status: "ready"; intentHash: string; checkedAt: number; expiresAt: number }
  | { status: "rejected"; reason: string };
export interface ExecutionAuthorization {
  action: "submit" | "cancel";
  intentHash: string;
  authorizationRef: string;
  expiresAt: number;
}
export type AuthorizeLive = (request: PreparedOrder & { action: "submit" | "cancel" }, signal: AbortSignal) => Promise<ExecutionAuthorization | null>;
export interface ExecutionCallOptions { signal: AbortSignal; authorizationRef?: string }
export type OrderLookup = { status: "found"; order: OrderSnapshot } | { status: "not-found" | "unknown" };
export type CancelReceipt = { status: "requested" } | { status: "resolved"; order: OrderSnapshot };
export interface ExecutionAdapter {
  readonly target: ExecutionTarget;
  /** Required service guarantee: durable atomic deduplication by target/clientOrderId and intentHash. */
  readonly idempotency: "durable-client-order-id";
  account(signal: AbortSignal): Promise<AccountSnapshot>;
  preflight(order: PreparedOrder, signal: AbortSignal): Promise<PreflightResult>;
  submit(order: PreparedOrder, options: ExecutionCallOptions): Promise<OrderSnapshot>;
  lookup(reference: OrderReference, signal: AbortSignal): Promise<OrderLookup>;
  cancel(reference: OrderReference, options: ExecutionCallOptions): Promise<CancelReceipt>;
}
export interface ExecutionRequestOptions { signal?: AbortSignal; authorizeLive?: AuthorizeLive; now?: () => number }
export type SubmissionOutcome =
  | { status: "submitted"; order: OrderSnapshot }
  | { status: "not-submitted"; reason: string }
  | { status: "reconcile-required"; reason: string };
export type CancellationOutcome = CancelReceipt | { status: "not-requested" | "reconcile-required"; reason: string };
