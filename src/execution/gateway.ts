import { prepareOrderIntent, validateOrderSnapshot } from "./validation.ts";
import type { CancellationOutcome, ExecutionAdapter, ExecutionAuthorization, ExecutionRequestOptions, OrderIntent, OrderLookup, PreparedOrder, SubmissionOutcome } from "./types.ts";

/** Stop observing promptly, but consume a late adapter rejection. Cancellation cannot undo remote effects. */
async function observe<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally { signal.removeEventListener("abort", abort); }
}

async function authorization(action: "submit" | "cancel", prepared: PreparedOrder, options: ExecutionRequestOptions, signal: AbortSignal): Promise<ExecutionAuthorization | undefined> {
  if (prepared.intent.target.mode === "paper") return undefined;
  if (!options.authorizeLive) throw new Error("Live authorization is required");
  const approval = structuredClone(await observe(options.authorizeLive({ ...structuredClone(prepared), action }, signal), signal));
  if (!approval || approval.action !== action || approval.intentHash !== prepared.intentHash
    || typeof approval.authorizationRef !== "string" || !approval.authorizationRef.trim()
    || !Number.isSafeInteger(approval.expiresAt)) throw new Error("Live authorization does not match this request");
  return approval;
}

function authorizationReference(approval: ExecutionAuthorization | undefined, now: number): string | undefined {
  if (!Number.isSafeInteger(now) || now < 0 || (approval && approval.expiresAt <= now)) throw new Error("Live authorization expired");
  return approval?.authorizationRef;
}

export async function submitOrder(adapter: ExecutionAdapter, input: OrderIntent, options: ExecutionRequestOptions = {}): Promise<SubmissionOutcome> {
  const signal = options.signal ?? new AbortController().signal;
  let dispatched = false, phase = "validation";
  try {
    signal.throwIfAborted();
    const prepared = prepareOrderIntent(input, adapter.target);
    if (adapter.idempotency !== "durable-client-order-id") throw new Error("Durable idempotency is required");
    phase = "preflight";
    const preflight = structuredClone(await observe(adapter.preflight(structuredClone(prepared), signal), signal));
    if (preflight.status !== "ready" || preflight.intentHash !== prepared.intentHash) throw new Error("Preflight did not approve this intent");
    phase = "authorization";
    const approval = await authorization("submit", prepared, options, signal);
    prepareOrderIntent(prepared.intent, adapter.target);
    const now = (options.now ?? Date.now)();
    const authorizationRef = authorizationReference(approval, now);
    phase = "preflight";
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(preflight.checkedAt) || !Number.isSafeInteger(preflight.expiresAt)
      || preflight.checkedAt < 0 || preflight.checkedAt > now || preflight.expiresAt <= now) throw new Error("Preflight expired");
    signal.throwIfAborted(); dispatched = true;
    const order = await observe(adapter.submit(structuredClone(prepared), { signal, authorizationRef }), signal);
    signal.throwIfAborted();
    return { status: "submitted", order: validateOrderSnapshot(order, prepared) };
  } catch {
    return dispatched ? { status: "reconcile-required", reason: "submission-unconfirmed" }
      : { status: "not-submitted", reason: signal.aborted ? "cancelled-before-submission" : `${phase}-failed` };
  }
}

export async function lookupOrder(adapter: ExecutionAdapter, input: OrderIntent, signal = new AbortController().signal): Promise<OrderLookup> {
  try {
    signal.throwIfAborted();
    const prepared = prepareOrderIntent(input, adapter.target);
    const result = await observe(adapter.lookup({ clientOrderId: prepared.intent.clientOrderId, intentHash: prepared.intentHash }, signal), signal);
    signal.throwIfAborted();
    if (result.status === "found") return { status: "found", order: validateOrderSnapshot(result.order, prepared) };
    return { status: result.status === "not-found" ? "not-found" : "unknown" };
  } catch { return { status: "unknown" }; }
}

export async function cancelOrder(adapter: ExecutionAdapter, input: OrderIntent, options: ExecutionRequestOptions = {}): Promise<CancellationOutcome> {
  const signal = options.signal ?? new AbortController().signal;
  let dispatched = false;
  try {
    signal.throwIfAborted();
    const prepared = prepareOrderIntent(input, adapter.target);
    const approval = await authorization("cancel", prepared, options, signal);
    prepareOrderIntent(prepared.intent, adapter.target);
    const authorizationRef = authorizationReference(approval, (options.now ?? Date.now)());
    signal.throwIfAborted(); dispatched = true;
    const result = await observe(adapter.cancel({ clientOrderId: prepared.intent.clientOrderId, intentHash: prepared.intentHash }, { signal, authorizationRef }), signal);
    signal.throwIfAborted();
    if (result.status === "requested") return { status: "requested" };
    if (result.status !== "resolved" || !["filled", "cancelled", "expired", "rejected"].includes(result.order.status)) throw new Error("Cancellation is unresolved");
    return { status: "resolved", order: validateOrderSnapshot(result.order, prepared) };
  } catch { return { status: dispatched ? "reconcile-required" : "not-requested", reason: dispatched ? "cancellation-unconfirmed" : "cancellation-not-authorized-or-ready" }; }
}
