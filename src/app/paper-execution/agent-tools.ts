/** Paper-only Agent tools. A trusted host binds one private adapter and reviews each mutation. */
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { cancelOrder, lookupOrder, prepareOrderIntent, submitOrder } from "../../execution/index.ts";
import type { AccountSnapshot, ExecutionAdapter, OrderIntent, OrderSnapshot, PreparedOrder, PreflightResult } from "../../execution/index.ts";
import { ok } from "../../tools/shared/results.ts";

const AccountInput = Type.Object({}, { additionalProperties: false });
const OrderInput = Type.Object({
  action: Type.Union([Type.Literal("submit"), Type.Literal("lookup"), Type.Literal("cancel")]),
  clientOrderId: Type.String({ minLength: 1 }),
  instrument: Type.Object({ symbol: Type.String({ minLength: 1 }), venue: Type.String({ minLength: 1 }),
    currency: Type.String({ minLength: 3 }) }, { additionalProperties: false }),
  side: Type.Union([Type.Literal("buy"), Type.Literal("sell")]),
  quantity: Type.String({ minLength: 1 }), limitPrice: Type.String({ minLength: 1 }),
  maxOrderNotional: Type.String({ minLength: 1 }), timeInForce: Type.Literal("gtc"),
}, { additionalProperties: false });

export interface PaperReviewRequest {
  action: "submit" | "cancel";
  prepared: PreparedOrder;
  account: AccountSnapshot;
  preflight?: Extract<PreflightResult, { status: "ready" }>;
  order?: OrderSnapshot;
}
export interface PaperReviewGrant { action: "submit" | "cancel"; intentHash: string; expiresAt: number }
export type ReviewPaperOrder = (request: PaperReviewRequest, signal: AbortSignal) => Promise<PaperReviewGrant | null>;

function verifyGrant(grant: PaperReviewGrant | null, action: "submit" | "cancel", prepared: PreparedOrder, now: number): void {
  if (!grant || grant.action !== action || grant.intentHash !== prepared.intentHash
    || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= now) {
    throw new Error("Paper action was not approved for this exact intent. No order action was sent.");
  }
}

export function createReviewedPaperTools(adapter: ExecutionAdapter, review: ReviewPaperOrder): AgentTool[] {
  if (adapter.target.mode !== "paper" || adapter.idempotency !== "durable-client-order-id")
    throw new Error("Agent paper tools require a paper-only durable execution adapter.");
  if (typeof review !== "function") throw new Error("A trusted paper-order reviewer is required.");
  const account: AgentTool<typeof AccountInput> = {
    name: "paper_account", label: "Paper.Account", parameters: AccountInput, executionMode: "sequential",
    description: "Read the explicitly selected private paper account. Balances and positions are simulated, not market or broker state. Use only inside a host-owned private paper session.",
    async execute(_id, input, signal) {
      if (!Check(AccountInput, input)) throw new Error("paper_account accepts no parameters.");
      signal?.throwIfAborted();
      const snapshot = await adapter.account(signal ?? new AbortController().signal);
      return ok(`Private paper account ${snapshot.target.accountRef}: ${JSON.stringify(snapshot.balances)}; positions ${JSON.stringify(snapshot.positions)}`,
        { visibility: "private-paper", account: snapshot });
    },
  };
  const order: AgentTool<typeof OrderInput> = {
    name: "paper_order", label: "Paper.Order", parameters: OrderInput, executionMode: "sequential",
    description: "Submit, look up, or cancel one GTC limit order for the host-selected private paper account. The account target is bound by the host; no live mode, account selection, automatic fill or market route. Submit and cancel require a separate trusted host review of the full intent and hash. An uncertain result requires lookup by the same clientOrderId and full intent; never auto-retry with a new ID.",
    async execute(_id, input, signal) {
      if (!Check(OrderInput, input)) throw new Error("Invalid paper order arguments; model approval flags and alternate targets are not accepted.");
      const active = signal ?? new AbortController().signal;
      active.throwIfAborted();
      const intent: OrderIntent = { version: 1, target: structuredClone(adapter.target),
        clientOrderId: input.clientOrderId, instrument: structuredClone(input.instrument), side: input.side,
        type: "limit", quantity: input.quantity, limitPrice: input.limitPrice,
        maxOrderNotional: input.maxOrderNotional, timeInForce: input.timeInForce };
      const prepared = prepareOrderIntent(intent, adapter.target);
      if (input.action === "lookup") {
        const outcome = await lookupOrder(adapter, prepared.intent, active);
        return ok(`Private paper lookup ${prepared.intent.clientOrderId}: ${outcome.status}`,
          { visibility: "private-paper", action: input.action, intentHash: prepared.intentHash, outcome });
      }
      if (input.action === "submit") {
        const preflight = await adapter.preflight(structuredClone(prepared), active);
        active.throwIfAborted();
        if (preflight.status !== "ready" || preflight.intentHash !== prepared.intentHash
          || !Number.isSafeInteger(preflight.expiresAt) || preflight.expiresAt <= Date.now()) {
          return ok(`Private paper order ${prepared.intent.clientOrderId}: not-submitted (preflight rejected)`,
            { visibility: "private-paper", action: input.action, intentHash: prepared.intentHash,
              outcome: { status: "not-submitted", reason: "preflight-rejected" } });
        }
        const accountSnapshot = await adapter.account(active);
        active.throwIfAborted();
        const grant = await review({ action: "submit", prepared: structuredClone(prepared),
          account: structuredClone(accountSnapshot), preflight: structuredClone(preflight) }, active);
        active.throwIfAborted();
        verifyGrant(grant, "submit", prepared, Date.now());
        // The gateway obtains a fresh preflight after human review, then checks it again
        // before dispatch. The earlier snapshot is only context for the reviewer.
        const outcome = await submitOrder(adapter, prepared.intent, { signal: active });
        return ok(`Private paper order ${prepared.intent.clientOrderId}: ${outcome.status}`,
          { visibility: "private-paper", action: input.action, intentHash: prepared.intentHash, outcome });
      }
      const found = await lookupOrder(adapter, prepared.intent, active);
      active.throwIfAborted();
      if (found.status !== "found") return ok(`Private paper cancel ${prepared.intent.clientOrderId}: ${found.status}; no cancel sent`,
        { visibility: "private-paper", action: input.action, intentHash: prepared.intentHash, outcome: found });
      const accountSnapshot = await adapter.account(active);
      active.throwIfAborted();
      const grant = await review({ action: "cancel", prepared: structuredClone(prepared),
        account: structuredClone(accountSnapshot), order: structuredClone(found.order) }, active);
      active.throwIfAborted();
      verifyGrant(grant, "cancel", prepared, Date.now());
      const outcome = await cancelOrder(adapter, prepared.intent, { signal: active });
      return ok(`Private paper cancel ${prepared.intent.clientOrderId}: ${outcome.status}`,
        { visibility: "private-paper", action: input.action, intentHash: prepared.intentHash, outcome });
    },
  };
  return [account, order];
}
