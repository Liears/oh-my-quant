import { createHash } from "node:crypto";
import type { ExecutionTarget, OrderIntent, OrderSnapshot, PreparedOrder } from "./types.ts";

function keys(value: object, expected: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error("Unexpected or missing execution fields");
}
function identifier(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) throw new Error("Invalid execution identifier");
}
function currency(value: string): void {
  if (typeof value !== "string" || !/^[A-Z]{3,8}$/.test(value)) throw new Error("Invalid quote currency");
}
function decimal(value: string, zero = false): { units: bigint; scale: bigint; text: string } {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,29})(?:\.\d{1,18})?$/.test(value)) throw new Error("Invalid decimal quantity or amount");
  const text = value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
  const [integer, fraction = ""] = text.split(".");
  const units = BigInt(integer! + fraction), scale = 10n ** BigInt(fraction.length);
  if (!zero && units === 0n) throw new Error("Quantity and price must be positive");
  return { units, scale, text };
}
function target(value: ExecutionTarget): ExecutionTarget {
  keys(value, ["adapterId", "accountRef", "mode"]); identifier(value.adapterId); identifier(value.accountRef);
  if (value.mode !== "paper" && value.mode !== "live") throw new Error("Execution mode must be explicit");
  return { adapterId: value.adapterId, accountRef: value.accountRef, mode: value.mode };
}
export function prepareOrderIntent(input: OrderIntent, expectedTarget: ExecutionTarget): PreparedOrder {
  const raw = structuredClone(input);
  keys(raw, ["version", "target", "clientOrderId", "instrument", "side", "type", "quantity", "limitPrice", "maxOrderNotional", "timeInForce"]);
  const orderTarget = target(raw.target);
  if (JSON.stringify(orderTarget) !== JSON.stringify(target(expectedTarget))) throw new Error("Execution target does not match adapter");
  if (raw.version !== 1 || raw.type !== "limit" || !["buy", "sell"].includes(raw.side) || !["day", "gtc", "ioc"].includes(raw.timeInForce)) throw new Error("Unsupported order intent");
  identifier(raw.clientOrderId); keys(raw.instrument, ["symbol", "venue", "currency"]);
  identifier(raw.instrument.symbol); identifier(raw.instrument.venue); currency(raw.instrument.currency);
  const quantity = decimal(raw.quantity), price = decimal(raw.limitPrice), cap = decimal(raw.maxOrderNotional);
  if (quantity.units * price.units * cap.scale > cap.units * quantity.scale * price.scale) throw new Error("Order exceeds its notional limit");
  const intent: OrderIntent = { version: 1, target: orderTarget, clientOrderId: raw.clientOrderId,
    instrument: { symbol: raw.instrument.symbol, venue: raw.instrument.venue, currency: raw.instrument.currency },
    side: raw.side, type: "limit", quantity: quantity.text, limitPrice: price.text, maxOrderNotional: cap.text, timeInForce: raw.timeInForce };
  return { intent, intentHash: createHash("sha256").update(JSON.stringify(intent)).digest("hex") };
}

export function validateOrderSnapshot(input: OrderSnapshot, prepared: PreparedOrder): OrderSnapshot {
  const order = structuredClone(input), { intent, intentHash } = prepareOrderIntent(prepared.intent, prepared.intent.target);
  if (intentHash !== prepared.intentHash) throw new Error("Prepared intent was changed");
  keys(order, ["target", "clientOrderId", "intentHash", "orderId", "status", "quantity", "filledQuantity", "fills", "observedAt"]);
  if (JSON.stringify(target(order.target)) !== JSON.stringify(intent.target) || order.clientOrderId !== intent.clientOrderId || order.intentHash !== intentHash) throw new Error("Order receipt does not match intent");
  identifier(order.orderId);
  if (!["accepted", "open", "partially-filled", "filled", "cancelled", "rejected", "expired"].includes(order.status)
    || !Number.isSafeInteger(order.observedAt) || order.observedAt < 0 || !Array.isArray(order.fills)) throw new Error("Invalid order receipt");
  const quantity = decimal(order.quantity), filled = decimal(order.filledQuantity, true), expected = decimal(intent.quantity), limit = decimal(intent.limitPrice);
  if (quantity.units * expected.scale !== expected.units * quantity.scale || filled.units * quantity.scale > quantity.units * filled.scale) throw new Error("Order quantity mismatch");
  if (order.status === "filled" && filled.units * quantity.scale !== quantity.units * filled.scale) throw new Error("Filled order has remaining quantity");
  if (order.status === "partially-filled" && (filled.units === 0n || filled.units * quantity.scale >= quantity.units * filled.scale)) throw new Error("Invalid partial fill");
  if (["accepted", "open", "rejected"].includes(order.status) && filled.units !== 0n) throw new Error("Order status contradicts fills");
  const ids = new Set<string>();
  let sum = 0n, scale = 1n;
  for (const fill of order.fills) {
    keys(fill, ["id", "quantity", "price", "fee", "at"]); identifier(fill.id);
    if (ids.has(fill.id)) throw new Error("Duplicate fill ID"); ids.add(fill.id);
    if (!Number.isSafeInteger(fill.at) || fill.at < 0 || fill.at > order.observedAt) throw new Error("Invalid fill time");
    const amount = decimal(fill.quantity), price = decimal(fill.price);
    if (intent.side === "buy" ? price.units * limit.scale > limit.units * price.scale : price.units * limit.scale < limit.units * price.scale) throw new Error("Fill violates limit price");
    if (fill.fee !== null) { keys(fill.fee, ["currency", "amount"]); currency(fill.fee.currency); decimal(fill.fee.amount, true); }
    if (amount.scale > scale) { sum *= amount.scale / scale; scale = amount.scale; }
    sum += amount.units * (scale / amount.scale);
  }
  if (sum * filled.scale !== filled.units * scale) throw new Error("Fill details do not match cumulative quantity");
  return order;
}
