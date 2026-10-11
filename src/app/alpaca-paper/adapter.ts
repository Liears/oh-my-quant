/** Long-only US-equity limit orders through one explicitly selected Alpaca paper account. */
import { prepareOrderIntent, validateOrderSnapshot } from "../../execution/index.ts";
import type { AccountSnapshot, ExecutionAdapter, ExecutionTarget, Fill, OrderLookup, OrderReference, OrderSnapshot, PreparedOrder, PreflightResult } from "../../execution/index.ts";
import { formatDecimal, multiplyDecimal, parseDecimal } from "../paper-execution/decimal.ts";
import { AlpacaPaperJournal } from "./journal.ts";
import { AlpacaPaperTransport } from "./transport.ts";
import type { AlpacaPaperCredentials } from "./transport.ts";

export interface AlpacaPaperOptions {
  /** Explicit private host directory, separate from app settings and public research artifacts. */
  root: string;
  accountRef: string;
  credentials: () => Promise<AlpacaPaperCredentials>;
  /** Test-only transport injection; production always uses global fetch and the fixed paper URL. */
  fetch?: typeof fetch;
  now?: () => number;
}
type BrokerRecord = Record<string, unknown>;
function object(value: unknown): BrokerRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Alpaca paper response");
  return value as BrokerRecord;
}
function field(value: BrokerRecord, key: string): string {
  if (typeof value[key] !== "string") throw new Error(`Invalid Alpaca paper ${key}`);
  return value[key] as string;
}
function amount(value: BrokerRecord, key: string): string { return formatDecimal(parseDecimal(field(value, key))); }
function time(value: string): number {
  const at = Date.parse(value);
  if (!Number.isSafeInteger(at) || at < 0) throw new Error("Invalid Alpaca paper timestamp");
  return at;
}
function validOrder(prepared: PreparedOrder): string | undefined {
  const { intent } = prepared;
  if (intent.target.mode !== "paper" || intent.target.adapterId !== "alpaca-paper") return "Paper target is required";
  if (intent.instrument.venue !== "ALPACA-US" || intent.instrument.currency !== "USD"
    || !/^[A-Z][A-Z0-9.]{0,14}$/.test(intent.instrument.symbol)) return "Only routed US equity symbols in USD are supported";
  if (intent.timeInForce !== "gtc" || !/^[1-9]\d*$/.test(intent.quantity))
    return "Only whole-share GTC limit orders are supported";
  return undefined;
}
function status(raw: string, filled: string): OrderSnapshot["status"] {
  if (raw === "filled") return "filled";
  if (raw === "partially_filled") return "partially-filled";
  if (raw === "canceled") return "cancelled";
  if (raw === "expired") return "expired";
  if (raw === "rejected") return "rejected";
  if (["accepted", "pending_new", "accepted_for_bidding", "stopped", "held"].includes(raw) && filled === "0") return "accepted";
  if (["new", "done_for_day", "pending_cancel"].includes(raw)) return filled === "0" ? "open" : "partially-filled";
  throw new Error("Alpaca paper order status cannot be safely mapped");
}

export function createAlpacaPaperAdapter(options: AlpacaPaperOptions): ExecutionAdapter {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(options.accountRef)) throw new Error("Invalid Alpaca paper account ID");
  const target: ExecutionTarget = { adapterId: "alpaca-paper", accountRef: options.accountRef, mode: "paper" };
  const journal = new AlpacaPaperJournal(options.root, target);
  const transport = new AlpacaPaperTransport(options.credentials, options.fetch);
  const clock = options.now ?? Date.now;
  function current(): number {
    const at = clock();
    if (!Number.isSafeInteger(at) || at < 0) throw new Error("Invalid Alpaca paper clock");
    return at;
  }

  async function brokerOrder(clientOrderId: string, signal: AbortSignal): Promise<BrokerRecord | null> {
    const response = await transport.call("GET", `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`, signal);
    return response.status === 404 ? null : object(response.data);
  }
  async function tradableAsset(symbol: string, signal: AbortSignal): Promise<boolean> {
    const response = await transport.call("GET", `/v2/assets/${encodeURIComponent(symbol)}`, signal);
    if (response.status === 404) return false;
    const asset = object(response.data);
    return asset.symbol === symbol && asset.class === "us_equity" && asset.status === "active" && asset.tradable === true;
  }
  async function fills(orderId: string, expected: PreparedOrder, signal: AbortSignal): Promise<Fill[]> {
    const result: Fill[] = [];
    let token: string | undefined;
    for (let page = 0; page < 100; page++) {
      const path = `/v2/account/activities/FILL?order_id=${encodeURIComponent(orderId)}&direction=asc&page_size=100`
        + (token ? `&page_token=${encodeURIComponent(token)}` : "");
      const { data } = await transport.call("GET", path, signal);
      if (!Array.isArray(data) || data.length > 100) throw new Error("Invalid Alpaca paper fill page");
      for (const item of data) {
        const row = object(item), id = field(row, "id");
        if (field(row, "order_id") !== orderId || field(row, "symbol") !== expected.intent.instrument.symbol
          || field(row, "side") !== expected.intent.side || field(row, "activity_type") !== "FILL")
          throw new Error("Alpaca paper fill identity mismatch");
        result.push({ id, quantity: amount(row, "qty"), price: amount(row, "price"),
          fee: null, at: time(field(row, "transaction_time")) });
        token = id;
      }
      if (data.length < 100) return result;
    }
    throw new Error("Alpaca paper fill pagination exceeded safe bound");
  }
  async function snapshot(raw: BrokerRecord, prepared: PreparedOrder, signal: AbortSignal): Promise<OrderSnapshot> {
    const { intent } = prepared, orderId = field(raw, "id"), filledQuantity = amount(raw, "filled_qty");
    if (field(raw, "client_order_id") !== intent.clientOrderId || field(raw, "symbol") !== intent.instrument.symbol
      || field(raw, "side") !== intent.side || field(raw, "type") !== "limit"
      || field(raw, "time_in_force") !== "gtc" || amount(raw, "qty") !== intent.quantity
      || amount(raw, "limit_price") !== intent.limitPrice
      || (raw.order_class !== undefined && raw.order_class !== "simple")
      || (raw.asset_class !== undefined && raw.asset_class !== "us_equity"))
      throw new Error("Alpaca paper order does not match reviewed intent");
    const observedAt = current();
    const order: OrderSnapshot = { target: structuredClone(target), clientOrderId: intent.clientOrderId,
      intentHash: prepared.intentHash, orderId, status: status(field(raw, "status"), filledQuantity),
      quantity: intent.quantity, filledQuantity, fills: filledQuantity === "0" ? [] : await fills(orderId, prepared, signal), observedAt };
    return validateOrderSnapshot(order, prepared);
  }
  async function account(signal: AbortSignal): Promise<AccountSnapshot> {
    const raw = object((await transport.call("GET", "/v2/account", signal)).data);
    if (field(raw, "id") !== target.accountRef) throw new Error("Alpaca paper account identity changed");
    const cash = amount(raw, "cash"), buyingPower = amount(raw, "buying_power");
    const balance = { currency: "USD", cash, availableCash: formatDecimal(
      parseDecimal(cash) < parseDecimal(buyingPower) ? parseDecimal(cash) : parseDecimal(buyingPower)) };
    const positions = (await transport.call("GET", "/v2/positions", signal)).data;
    if (!Array.isArray(positions)) throw new Error("Invalid Alpaca paper positions");
    return { target: structuredClone(target), observedAt: current(), balances: [balance],
      positions: positions.flatMap(item => {
        const row = object(item);
        if (row.asset_class !== "us_equity" || typeof row.qty !== "string" || row.qty.startsWith("-")) return [];
        const quantity = amount(row, "qty");
        return [{ instrument: { symbol: field(row, "symbol"), venue: "ALPACA-US", currency: "USD" },
          quantity, availableQuantity: quantity }];
      }) };
  }

  const adapter: ExecutionAdapter = {
    target, idempotency: "durable-client-order-id", account,
    preflight: async (input, signal): Promise<PreflightResult> => {
      try {
        const prepared = prepareOrderIntent(input.intent, target);
        if (prepared.intentHash !== input.intentHash) throw new Error("Prepared order changed");
        const reason = validOrder(prepared);
        if (reason) return { status: "rejected", reason };
        await journal.check(prepared.intent.clientOrderId, prepared.intentHash, signal);
        const remote = object((await transport.call("GET", "/v2/account", signal)).data);
        if (field(remote, "id") !== target.accountRef || remote.trading_blocked === true || remote.status !== "ACTIVE")
          return { status: "rejected", reason: "Paper account is unavailable or blocked" };
        if (!(await tradableAsset(prepared.intent.instrument.symbol, signal)))
          return { status: "rejected", reason: "Paper asset is not active and tradable" };
        const holdings = await account(signal);
        const { intent } = prepared;
        if (intent.side === "buy") {
          const available = parseDecimal(holdings.balances[0]!.availableCash);
          if (multiplyDecimal(parseDecimal(intent.quantity), parseDecimal(intent.limitPrice)) > available)
            return { status: "rejected", reason: "Insufficient paper cash" };
        } else {
          const held = holdings.positions.find(position => position.instrument.symbol === intent.instrument.symbol)?.availableQuantity ?? "0";
          if (parseDecimal(intent.quantity) > parseDecimal(held)) return { status: "rejected", reason: "Insufficient long paper position" };
        }
        const at = current();
        return { status: "ready", intentHash: prepared.intentHash, checkedAt: at, expiresAt: at + 5000 };
      } catch { return { status: "rejected", reason: "Alpaca paper preflight could not be verified" }; }
    },
    submit: async (input, call) => {
      const prepared = prepareOrderIntent(input.intent, target);
      if (prepared.intentHash !== input.intentHash || validOrder(prepared)) throw new Error("Invalid Alpaca paper submission");
      const active = object((await transport.call("GET", "/v2/account", call.signal)).data);
      if (field(active, "id") !== target.accountRef || active.trading_blocked === true || active.status !== "ACTIVE")
        throw new Error("Alpaca paper account is unavailable or changed");
      if (!(await tradableAsset(prepared.intent.instrument.symbol, call.signal)))
        throw new Error("Alpaca paper asset is no longer active and tradable");
      const binding = await journal.check(prepared.intent.clientOrderId, prepared.intentHash, call.signal);
      const existing = await brokerOrder(prepared.intent.clientOrderId, call.signal);
      if (binding === "bound") {
        if (!existing) throw new Error("Prior Alpaca paper dispatch requires manual reconciliation");
        return snapshot(existing, prepared, call.signal);
      }
      if (existing) throw new Error("Client order ID already exists outside this private journal");
      if (!(await journal.reserve(prepared, call.signal))) throw new Error("Concurrent Alpaca paper dispatch requires reconciliation");
      const { intent } = prepared;
      const response = await transport.call("POST", "/v2/orders", call.signal, {
        symbol: intent.instrument.symbol, qty: intent.quantity, side: intent.side, type: "limit",
        time_in_force: "gtc", limit_price: intent.limitPrice, client_order_id: intent.clientOrderId,
        order_class: "simple", extended_hours: false });
      return snapshot(object(response.data), prepared, call.signal);
    },
    lookup: async (reference: OrderReference, signal: AbortSignal): Promise<OrderLookup> => {
      try {
        if (await journal.check(reference.clientOrderId, reference.intentHash, signal) !== "bound") return { status: "unknown" };
        const raw = await brokerOrder(reference.clientOrderId, signal);
        if (!raw) return { status: "unknown" };
        const body = object((await transport.call("GET", "/v2/account", signal)).data);
        if (field(body, "id") !== target.accountRef) return { status: "unknown" };
        const entry = await journalPrepared(reference, signal);
        return { status: "found", order: await snapshot(raw, entry, signal) };
      } catch { return { status: "unknown" }; }
    },
    cancel: async (reference, call) => {
      const active = object((await transport.call("GET", "/v2/account", call.signal)).data);
      if (field(active, "id") !== target.accountRef) throw new Error("Alpaca paper account identity changed");
      const prepared = await journalPrepared(reference, call.signal);
      const raw = await brokerOrder(reference.clientOrderId, call.signal);
      if (!raw) throw new Error("Alpaca paper order is not visible for cancellation");
      const order = await snapshot(raw, prepared, call.signal);
      if (["filled", "cancelled", "expired", "rejected"].includes(order.status)) return { status: "resolved", order };
      const result = await transport.call("DELETE", `/v2/orders/${encodeURIComponent(order.orderId)}`, call.signal);
      if (result.status !== 204) throw new Error("Alpaca paper cancellation was not acknowledged");
      return { status: "requested" };
    },
  };

  async function journalPrepared(reference: OrderReference, signal: AbortSignal): Promise<PreparedOrder> {
    return journal.prepared(reference, signal);
  }
  return adapter;
}
