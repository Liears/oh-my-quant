import { prepareOrderIntent, validateOrderSnapshot } from "../../execution/index.ts";
import type { AccountSnapshot, ExecutionAdapter, ExecutionTarget, Fill, OrderReference, OrderSnapshot, PreparedOrder, PreflightResult } from "../../execution/index.ts";
import { formatDecimal, multiplyDecimal, parseDecimal } from "./decimal.ts";
import { instrumentKey, PaperLedgerFile } from "./ledger.ts";
import type { OpeningPaperAccount, PaperLedger, PaperOrderRecord } from "./ledger.ts";

export interface LocalPaperOptions {
  /** Host-owned private directory; never selected from market cache or Agent settings. */
  root: string;
  target: ExecutionTarget;
  /** Required only when creating a new ledger. Restarted hosts read its durable account. */
  openingAccount?: OpeningPaperAccount;
  now?: () => number;
}
export interface LocalPaperService { adapter: ExecutionAdapter; recordFill(reference: OrderReference, fill: Fill, signal?: AbortSignal): Promise<OrderSnapshot> }

function current(clock: () => number): number {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid paper clock");
  return value;
}
function remaining(record: PaperOrderRecord): bigint {
  return parseDecimal(record.prepared.intent.quantity) - parseDecimal(record.order.filledQuantity);
}
function pending(record: PaperOrderRecord): boolean {
  return ["accepted", "open", "partially-filled"].includes(record.order.status);
}
function cash(body: PaperLedger, currency: string): bigint {
  return parseDecimal(body.balances.find(balance => balance.currency === currency)?.cash ?? "0");
}
function holding(body: PaperLedger, key: string): bigint {
  return parseDecimal(body.positions.find(position => instrumentKey(position.instrument) === key)?.quantity ?? "0");
}
function availableCash(body: PaperLedger, currency: string): bigint {
  let available = cash(body, currency);
  for (const record of body.orders) if (pending(record) && record.prepared.intent.side === "buy" && record.prepared.intent.instrument.currency === currency)
    available -= multiplyDecimal(remaining(record), parseDecimal(record.prepared.intent.limitPrice));
  return available;
}
function availableHolding(body: PaperLedger, key: string): bigint {
  let available = holding(body, key);
  for (const record of body.orders) if (pending(record) && record.prepared.intent.side === "sell" && instrumentKey(record.prepared.intent.instrument) === key)
    available -= remaining(record);
  return available;
}
function account(body: PaperLedger, at: number): AccountSnapshot {
  return { target: structuredClone(body.target), observedAt: at,
    balances: body.balances.map(balance => ({ currency: balance.currency, cash: balance.cash,
      availableCash: formatDecimal(availableCash(body, balance.currency)) })),
    positions: body.positions.map(position => ({ instrument: structuredClone(position.instrument), quantity: position.quantity,
      availableQuantity: formatDecimal(availableHolding(body, instrumentKey(position.instrument))) })) };
}
function find(body: PaperLedger, reference: OrderReference): PaperOrderRecord | undefined {
  const record = body.orders.find(item => item.prepared.intent.clientOrderId === reference.clientOrderId);
  if (record && record.prepared.intentHash !== reference.intentHash) throw new Error("Paper client order ID conflict");
  return record;
}
function check(body: PaperLedger, prepared: PreparedOrder): string | undefined {
  const { intent } = prepared;
  if (intent.timeInForce !== "gtc") return "Local paper service supports GTC only; no exchange session calendar is connected";
  try {
    const quantity = parseDecimal(intent.quantity), price = parseDecimal(intent.limitPrice);
    if (intent.side === "buy") {
      const balance = body.balances.find(item => item.currency === intent.instrument.currency);
      if (!balance) return "Quote currency is absent from the paper account";
      if (multiplyDecimal(quantity, price) > availableCash(body, intent.instrument.currency)) return "Insufficient paper cash";
    } else if (quantity > availableHolding(body, instrumentKey(intent.instrument))) return "Insufficient paper position";
  } catch { return "Paper amount exceeds exact simulator range"; }
  return undefined;
}

/** An opt-in, file-backed paper service. Fills are explicit synthetic events, never market orders. */
export function createLocalPaperService(options: LocalPaperOptions): LocalPaperService {
  if (options.target.mode !== "paper") throw new Error("Local paper service cannot use live mode");
  const target = structuredClone(options.target);
  const clock = options.now ?? Date.now;
  const file = new PaperLedgerFile(options.root, target, options.openingAccount && structuredClone(options.openingAccount));
  const adapter: ExecutionAdapter = {
    target, idempotency: "durable-client-order-id",
    account: signal => file.transact(signal, body => account(body, current(clock))),
    preflight: (input, signal): Promise<PreflightResult> => file.transact(signal, body => {
      const prepared = prepareOrderIntent(input.intent, target);
      if (prepared.intentHash !== input.intentHash) return { status: "rejected", reason: "Paper intent changed" };
      const reference = { clientOrderId: prepared.intent.clientOrderId, intentHash: prepared.intentHash };
      const at = current(clock);
      try { if (find(body, reference)) return { status: "ready", intentHash: prepared.intentHash, checkedAt: at, expiresAt: at + 5000 }; }
      catch { return { status: "rejected", reason: "Paper client order ID conflict" }; }
      const reason = check(body, prepared);
      return reason ? { status: "rejected", reason } : { status: "ready", intentHash: prepared.intentHash, checkedAt: at, expiresAt: at + 5000 };
    }),
    submit: (input, call) => file.transact(call.signal, (body, save) => {
      const prepared = prepareOrderIntent(input.intent, target);
      if (prepared.intentHash !== input.intentHash) throw new Error("Paper intent changed");
      const existing = find(body, { clientOrderId: prepared.intent.clientOrderId, intentHash: prepared.intentHash });
      if (existing) return structuredClone(existing.order);
      const reason = check(body, prepared);
      if (reason) throw new Error(reason);
      const order: OrderSnapshot = { target: structuredClone(target), clientOrderId: prepared.intent.clientOrderId,
        intentHash: prepared.intentHash, orderId: `paper-${prepared.intentHash.slice(0, 32)}`, status: "open",
        quantity: prepared.intent.quantity, filledQuantity: "0", fills: [], observedAt: current(clock) };
      body.orders.push({ prepared, order }); save();
      return structuredClone(order);
    }),
    lookup: (reference, signal) => file.transact(signal, body => {
      try {
        const record = find(body, reference);
        return record ? { status: "found" as const, order: structuredClone(record.order) } : { status: "not-found" as const };
      } catch { return { status: "unknown" as const }; }
    }),
    cancel: (reference, call) => file.transact(call.signal, (body, save) => {
      const record = find(body, reference);
      if (!record) throw new Error("Paper order not found");
      if (pending(record)) { record.order.status = "cancelled"; record.order.observedAt = current(clock); save(); }
      return { status: "resolved" as const, order: structuredClone(record.order) };
    }),
  };
  return { adapter, recordFill: (reference, fill, signal = new AbortController().signal) => file.transact(signal, (body, save) => {
    const record = find(body, reference);
    if (!record || !pending(record)) throw new Error("Paper order is not fillable");
    const { intent } = record.prepared;
    if (fill.fee === null) throw new Error("Local paper ledger requires a known fill fee to update cash");
    if (fill.fee.currency !== intent.instrument.currency) throw new Error("Paper fee currency must match the quote currency");
    const quantity = parseDecimal(fill.quantity), price = parseDecimal(fill.price), fee = parseDecimal(fill.fee.amount);
    if (quantity <= 0n || quantity > remaining(record)) throw new Error("Paper fill exceeds remaining quantity");
    const notional = multiplyDecimal(quantity, price), currency = intent.instrument.currency;
    record.order.fills.push(structuredClone(fill));
    record.order.filledQuantity = formatDecimal(parseDecimal(record.order.filledQuantity) + quantity);
    record.order.status = remaining(record) === 0n ? "filled" : "partially-filled";
    record.order.observedAt = current(clock);
    validateOrderSnapshot(record.order, record.prepared);
    let balance = body.balances.find(item => item.currency === currency);
    if (!balance) { balance = { currency, cash: "0" }; body.balances.push(balance); }
    let position = body.positions.find(item => instrumentKey(item.instrument) === instrumentKey(intent.instrument));
    if (!position) { position = { instrument: structuredClone(intent.instrument), quantity: "0" }; body.positions.push(position); }
    const updatedCash = cash(body, currency) + (intent.side === "buy" ? -notional - fee : notional - fee);
    const updatedHolding = holding(body, instrumentKey(intent.instrument)) + (intent.side === "buy" ? quantity : -quantity);
    balance.cash = formatDecimal(updatedCash); position.quantity = formatDecimal(updatedHolding);
    if (availableCash(body, currency) < 0n || availableHolding(body, instrumentKey(intent.instrument)) < 0n)
      throw new Error("Paper fill would breach reserved account resources");
    save(); return structuredClone(record.order);
  }) };
}
