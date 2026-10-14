import type { ExecutionAdapter, ExecutionTarget, OrderIntent, OrderSnapshot, PreparedOrder } from "../../index.ts";

export function intent(mode: "paper" | "live" = "paper"): OrderIntent {
  return { version: 1, target: { adapterId: "fixture", accountRef: "synthetic-account", mode }, clientOrderId: "request-1",
    instrument: { symbol: "EXAMPLE", venue: "TEST", currency: "USD" }, side: "buy", type: "limit",
    quantity: "2", limitPrice: "10", maxOrderNotional: "20", timeInForce: "day" };
}
export function receipt(prepared: PreparedOrder): OrderSnapshot {
  return { target: structuredClone(prepared.intent.target), clientOrderId: prepared.intent.clientOrderId, intentHash: prepared.intentHash,
    orderId: `fixture-${prepared.intent.clientOrderId}`, status: "open", quantity: prepared.intent.quantity, filledQuantity: "0", fills: [], observedAt: 1000 };
}

/** A shared synthetic authority for contract tests only; this in-memory ledger is not a production durable adapter. */
export function service(target: ExecutionTarget = intent().target) {
  const orders = new Map<string, OrderSnapshot>();
  const calls = { preflight: 0, submit: 0, lookup: 0, cancel: 0, created: 0 };
  const adapter: ExecutionAdapter = { target, idempotency: "durable-client-order-id",
    async account() { return { target: structuredClone(target), observedAt: 1000, balances: [], positions: [] }; },
    async preflight(prepared) { calls.preflight++; return { status: "ready", intentHash: prepared.intentHash, checkedAt: 1000, expiresAt: 2000 }; },
    async submit(prepared) {
      calls.submit++;
      const existing = orders.get(prepared.intent.clientOrderId);
      if (existing && existing.intentHash !== prepared.intentHash) throw new Error("Fixture service rejects key reuse; private-credential must not appear in output");
      if (!existing) { orders.set(prepared.intent.clientOrderId, receipt(prepared)); calls.created++; }
      return structuredClone(orders.get(prepared.intent.clientOrderId)!);
    },
    async lookup(reference) {
      calls.lookup++;
      const order = orders.get(reference.clientOrderId);
      if (order && order.intentHash !== reference.intentHash) throw new Error("Key mismatch");
      return order ? { status: "found", order: structuredClone(order) } : { status: "not-found" };
    },
    async cancel(reference) {
      calls.cancel++;
      const order = orders.get(reference.clientOrderId);
      if (!order || order.intentHash !== reference.intentHash) throw new Error("Unknown order");
      return ["cancelled", "filled", "expired", "rejected"].includes(order.status)
        ? { status: "resolved", order: structuredClone(order) } : { status: "requested" };
    },
  };
  return { adapter, calls, orders };
}
