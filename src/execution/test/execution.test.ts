import { expect, it } from "bun:test";
import { cancelOrder, lookupOrder, prepareOrderIntent, submitOrder, validateOrderSnapshot } from "../index.ts";
import type { AuthorizeLive, OrderSnapshot, PreflightResult } from "../index.ts";
import { intent, receipt, service } from "./fixtures/service.ts";

const now = () => 1000;
const approve: AuthorizeLive = async request => ({ action: request.action, intentHash: request.intentHash, authorizationRef: "fixture-user-approval", expiresAt: 2000 });

it("preserves an unreported fill fee as unknown without inventing zero", () => {
  const input = { ...intent(), quantity: "1", limitPrice: "10", maxOrderNotional: "10" };
  const prepared = prepareOrderIntent(input, input.target), order = receipt(prepared);
  order.status = "filled"; order.filledQuantity = "1";
  order.fills = [{ id: "broker-fill", quantity: "1", price: "9", fee: null, at: 900 }];
  expect(validateOrderSnapshot(order, prepared).fills[0]!.fee).toBeNull();
  order.fills[0]!.fee = { currency: "USD", amount: "0" };
  expect(validateOrderSnapshot(order, prepared).fills[0]!.fee).toEqual({ currency: "USD", amount: "0" });
  order.fills[0]!.fee = { currency: "USD", amount: "-1" };
  expect(() => validateOrderSnapshot(order, prepared)).toThrow("decimal");
});

it("canonicalizes decimal intent without floating-point budget comparisons or mutable caller references", () => {
  const input = { ...intent(), quantity: "0.10", limitPrice: "0.20", maxOrderNotional: "0.020" };
  const prepared = prepareOrderIntent(input, input.target);
  expect(prepared.intent).toMatchObject({ quantity: "0.1", limitPrice: "0.2", maxOrderNotional: "0.02" });
  expect(prepareOrderIntent(prepared.intent, input.target).intentHash).toBe(prepared.intentHash);
  expect(() => prepareOrderIntent({ ...input, maxOrderNotional: "0.019999999999999999" }, input.target)).toThrow("notional limit");
  input.target.accountRef = "changed"; input.quantity = "99";
  expect(prepared.intent.target.accountRef).toBe("synthetic-account");
  const large = { ...intent(), quantity: "999999999999999999999999999999", limitPrice: "0.000000000000000001", maxOrderNotional: "999999999999.999999999999999999" };
  expect(prepareOrderIntent(large, large.target).intent.quantity).toBe(large.quantity);
});

it.each(["0", "-1", "1e2", "NaN", "01", "0.0000000000000000001"])("rejects unsupported quantity %s before touching the adapter", async quantity => {
  const fixture = service();
  expect(await submitOrder(fixture.adapter, { ...intent(), quantity }, { now })).toMatchObject({ status: "not-submitted", reason: "validation-failed" });
  expect(fixture.calls).toEqual({ preflight: 0, submit: 0, lookup: 0, cancel: 0, created: 0 });
});

it("rejects target and unsupported-field changes rather than silently omitting them from authorization", async () => {
  const fixture = service();
  expect(await submitOrder(fixture.adapter, intent("live"), { now, authorizeLive: approve })).toMatchObject({ status: "not-submitted" });
  const extra = { ...intent(), leverage: "2" };
  expect(() => prepareOrderIntent(extra, extra.target)).toThrow("fields");
  expect(fixture.calls.preflight).toBe(0);
});

it("binds live approval to action and the entire intent and checks its expiry at dispatch", async () => {
  const input = intent("live"), fixture = service(input.target);
  for (const authorizeLive of [undefined, async () => null, async request => ({ ...(await approve(request, new AbortController().signal))!, action: "cancel" as const }),
    async request => ({ ...(await approve(request, new AbortController().signal))!, intentHash: "different" }),
    async request => ({ ...(await approve(request, new AbortController().signal))!, expiresAt: 1000 })] as Array<AuthorizeLive | undefined>) {
    expect(await submitOrder(fixture.adapter, input, { now, authorizeLive })).toMatchObject({ status: "not-submitted", reason: "authorization-failed" });
  }
  expect(fixture.calls.submit).toBe(0);
  let reference: string | undefined;
  const submit = fixture.adapter.submit;
  fixture.adapter.submit = async (prepared, options) => { reference = options.authorizationRef; return submit(prepared, options); };
  expect(await submitOrder(fixture.adapter, input, { now, authorizeLive: approve })).toMatchObject({ status: "submitted" });
  expect(reference).toBe("fixture-user-approval");
});

it("rechecks a captured preflight after authorization and ignores later mutation of its receipt", async () => {
  const input = intent("live"), fixture = service(input.target);
  let time = 1000;
  const preflight: PreflightResult = { status: "ready", intentHash: prepareOrderIntent(input, input.target).intentHash, checkedAt: 1000, expiresAt: 1500 };
  fixture.adapter.preflight = async () => preflight;
  const outcome = await submitOrder(fixture.adapter, input, { now: () => time, authorizeLive: async request => {
    time = 1600; preflight.expiresAt = 3000;
    return approve(request, new AbortController().signal);
  } });
  expect(outcome).toMatchObject({ status: "not-submitted", reason: "preflight-failed" });
  expect(fixture.calls.submit).toBe(0);
});

it("does not authorize or submit when preflight rejects, fails or approves a different digest", async () => {
  const input = intent("live"), fixture = service(input.target);
  let authorizations = 0;
  const authorizeLive: AuthorizeLive = async (request, signal) => { authorizations++; return approve(request, signal); };
  for (const check of [async (): Promise<PreflightResult> => ({ status: "rejected", reason: "market-closed" }),
    async (): Promise<PreflightResult> => ({ status: "ready", intentHash: "wrong", checkedAt: 1000, expiresAt: 2000 }),
    async (): Promise<PreflightResult> => { throw new Error("private-preflight-key"); }]) {
    fixture.adapter.preflight = check;
    const result = await submitOrder(fixture.adapter, input, { now, authorizeLive });
    expect(result).toMatchObject({ status: "not-submitted", reason: "preflight-failed" });
    expect(JSON.stringify(result)).not.toContain("private-preflight-key");
  }
  expect(authorizations).toBe(0); expect(fixture.calls.submit).toBe(0);
});

it("rejects adapters without durable idempotency before any preflight or submit", async () => {
  const fixture = service();
  Object.defineProperty(fixture.adapter, "idempotency", { value: "process-local" });
  expect(await submitOrder(fixture.adapter, intent(), { now })).toMatchObject({ status: "not-submitted", reason: "validation-failed" });
  expect(fixture.calls.preflight).toBe(0); expect(fixture.calls.submit).toBe(0);
});

it("rejects an account switch while live authorization is pending", async () => {
  const input = intent("live"), fixture = service(structuredClone(input.target));
  const result = await submitOrder(fixture.adapter, input, { now, authorizeLive: async (request, signal) => {
    fixture.adapter.target.accountRef = "another-account";
    return approve(request, signal);
  } });
  expect(result.status).toBe("not-submitted"); expect(fixture.calls.submit).toBe(0);
});

it("uses a captured intent even when the caller or preflight adapter mutates its input", async () => {
  const input = intent(), fixture = service();
  let finish!: (value: PreflightResult) => void;
  const pending = new Promise<PreflightResult>(resolve => { finish = resolve; });
  let hash = "";
  fixture.adapter.preflight = async prepared => { hash = prepared.intentHash; prepared.intent.quantity = "900"; return pending; };
  const result = submitOrder(fixture.adapter, input, { now });
  input.quantity = "100";
  finish({ status: "ready", intentHash: hash, checkedAt: 1000, expiresAt: 2000 });
  expect(await result).toMatchObject({ status: "submitted", order: { quantity: "2" } });
});

it("requires adapter-owned idempotency across independent clients and rejects key reuse for a different intent", async () => {
  const fixture = service();
  const outcomes = await Promise.all([submitOrder(fixture.adapter, intent(), { now }), submitOrder({ ...fixture.adapter }, intent(), { now })]);
  expect(outcomes[0]).toEqual(outcomes[1]); expect(fixture.calls.created).toBe(1);
  const conflict = await submitOrder(fixture.adapter, { ...intent(), quantity: "1" }, { now });
  expect(conflict.status).toBe("reconcile-required");
  expect(JSON.stringify(conflict)).not.toContain("private-credential");
  expect(fixture.calls.created).toBe(1);
  expect(await lookupOrder(fixture.adapter, intent())).toMatchObject({ status: "found", order: { quantity: "2" } });
});

it("reconciles an accepted order after a lost receipt without submitting another order", async () => {
  const fixture = service(), submit = fixture.adapter.submit;
  fixture.adapter.submit = async (prepared, options) => { await submit(prepared, options); throw new Error("Connection dropped after acceptance"); };
  expect(await submitOrder(fixture.adapter, intent(), { now })).toEqual({ status: "reconcile-required", reason: "submission-unconfirmed" });
  expect(await lookupOrder({ ...fixture.adapter }, intent())).toMatchObject({ status: "found", order: { status: "open" } });
  expect(await lookupOrder(fixture.adapter, { ...intent(), clientOrderId: "not-observed" })).toEqual({ status: "not-found" });
  expect(fixture.calls.submit).toBe(1); expect(fixture.calls.created).toBe(1);
});

it("cancels before dispatch without a submit and treats cancellation after dispatch as uncertain", async () => {
  const fixture = service(), controller = new AbortController();
  fixture.adapter.preflight = async () => new Promise(() => {});
  const before = submitOrder(fixture.adapter, intent(), { now, signal: controller.signal }); controller.abort();
  expect(await before).toMatchObject({ status: "not-submitted", reason: "cancelled-before-submission" });
  expect(fixture.calls.submit).toBe(0);
  const accepted = service(), afterController = new AbortController(), submit = accepted.adapter.submit;
  let entered!: () => void, rejectLate!: (error: Error) => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  accepted.adapter.submit = async (prepared, options) => { await submit(prepared, options); entered(); return new Promise((_resolve, reject) => { rejectLate = reject; }); };
  const after = submitOrder(accepted.adapter, intent(), { now, signal: afterController.signal });
  await enteredPromise; afterController.abort();
  expect(await after).toMatchObject({ status: "reconcile-required" });
  rejectLate(new Error("Late rejection is consumed"));
  expect(await lookupOrder(accepted.adapter, intent())).toMatchObject({ status: "found" });
  expect(accepted.calls.submit).toBe(1);
});

it("keeps partial fills when cancellation is confirmed and never treats an acknowledgement as a cancelled order", async () => {
  const input = { ...intent(), quantity: "1", limitPrice: "1", maxOrderNotional: "1" }, fixture = service();
  const prepared = prepareOrderIntent(input, input.target), order = receipt(prepared);
  order.status = "partially-filled"; order.filledQuantity = "0.3";
  order.fills = [{ id: "first", quantity: "0.1", price: "1", fee: { currency: "USD", amount: "0.01" }, at: 900 },
    { id: "second", quantity: "0.2", price: "1", fee: { currency: "USD", amount: "0.02" }, at: 1000 }];
  fixture.orders.set(input.clientOrderId, order);
  expect(await cancelOrder(fixture.adapter, input, { now })).toEqual({ status: "requested" });
  expect(order.status).toBe("partially-filled");
  order.status = "cancelled";
  expect(await cancelOrder(fixture.adapter, input, { now })).toMatchObject({ status: "resolved", order: { status: "cancelled", filledQuantity: "0.3", fills: order.fills } });
});

it("requires separate live cancellation approval and preserves a fill that wins the cancellation race", async () => {
  const input = intent("live"), fixture = service(input.target), order = receipt(prepareOrderIntent(input, input.target));
  order.status = "filled"; order.filledQuantity = "2";
  order.fills = [{ id: "fill-1", quantity: "2", price: "9", fee: { currency: "USD", amount: "0" }, at: 1000 }];
  fixture.orders.set(input.clientOrderId, order);
  expect(await cancelOrder(fixture.adapter, input, { now, authorizeLive: async request => ({ ...(await approve(request, new AbortController().signal))!, action: "submit" }) })).toMatchObject({ status: "not-requested" });
  expect(fixture.calls.cancel).toBe(0);
  expect(await cancelOrder(fixture.adapter, input, { now, authorizeLive: approve })).toMatchObject({ status: "resolved", order: { status: "filled" } });
});

it("rejects contradictory receipts instead of reporting a verified fill", async () => {
  const input = intent(), prepared = prepareOrderIntent(input, input.target), valid = receipt(prepared);
  valid.status = "filled"; valid.filledQuantity = "2";
  valid.fills = [{ id: "fill-1", quantity: "2", price: "10", fee: { currency: "USD", amount: "0" }, at: 1000 }];
  const invalid: OrderSnapshot[] = [
    { ...valid, filledQuantity: "3" }, { ...valid, intentHash: "wrong" }, { ...valid, status: "open" },
    { ...valid, target: { ...valid.target, mode: "live" } }, { ...valid, fills: [valid.fills[0]!, valid.fills[0]!] },
    { ...valid, fills: [{ ...valid.fills[0]!, price: "11" }] }, { ...valid, fills: [] },
  ];
  expect(validateOrderSnapshot(valid, prepared)).toEqual(valid);
  expect(() => validateOrderSnapshot(valid, { ...prepared, intent: { ...prepared.intent, quantity: "1" } })).toThrow("Prepared intent was changed");
  for (const order of invalid) {
    const fixture = service(); fixture.adapter.submit = async () => order;
    expect(() => validateOrderSnapshot(order, prepared)).toThrow();
    expect(await submitOrder(fixture.adapter, input, { now })).toMatchObject({ status: "reconcile-required" });
  }
});
