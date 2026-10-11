import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { cancelOrder, lookupOrder, prepareOrderIntent, submitOrder } from "../../../execution/index.ts";
import type { OrderIntent } from "../../../execution/index.ts";
import { createLocalPaperService } from "../adapter.ts";

const roots: string[] = [];
const target = { adapterId: "local-paper", accountRef: "fixture-account", mode: "paper" as const };
const now = () => 1000;
function root(): string { const path = mkdtempSync(join(tmpdir(), "ohquant-paper-test-")); roots.push(path); return path; }
function service(path: string, cash = "100") {
  return createLocalPaperService({ root: path, target, openingAccount: { balances: [{ currency: "USD", cash }], positions: [] }, now });
}
function intent(clientOrderId = "request-1", quantity = "2", price = "10"): OrderIntent {
  return { version: 1, target, clientOrderId, instrument: { symbol: "EXAMPLE", venue: "TEST", currency: "USD" },
    side: "buy", type: "limit", quantity, limitPrice: price, maxOrderNotional: "100", timeInForce: "gtc" };
}
afterEach(() => {
  for (const path of roots.splice(0)) {
    const resolved = realpathSync(path), temporary = realpathSync(tmpdir());
    if (!resolved.startsWith(temporary + sep)) throw new Error("Refusing to remove a path outside the temporary directory");
    rmSync(resolved, { recursive: true, force: true });
  }
});

it("deduplicates the same client order across independent processes and a restarted host", async () => {
  const path = root();
  const worker = resolve(import.meta.dir, "fixtures", "submit-worker.ts");
  const processes = [Bun.spawn([process.execPath, "run", worker, path, "cross-process-1"], { stdout: "pipe", stderr: "pipe" }),
    Bun.spawn([process.execPath, "run", worker, path, "cross-process-1"], { stdout: "pipe", stderr: "pipe" })];
  const results = await Promise.all(processes.map(async process => {
    const [code, output, error] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    expect(code).toBe(0); expect(error).toBe("");
    return JSON.parse(output) as { status: string; order: { orderId: string } };
  }));
  expect(results[0]).toEqual(results[1]); expect(results[0]?.status).toBe("submitted");
  const ledger = JSON.parse(readFileSync(join(path, "orders.json"), "utf8")) as { body: { orders: unknown[] } };
  expect(ledger.body.orders).toHaveLength(1);
  const restarted = service(path);
  const original = { ...intent("cross-process-1", "2", "10"), maxOrderNotional: "20" };
  expect(await lookupOrder(restarted.adapter, original)).toMatchObject({ status: "found", order: { orderId: results[0]?.order.orderId } });
  expect(await submitOrder(restarted.adapter, original, { now })).toMatchObject({ status: "submitted", order: { orderId: results[0]?.order.orderId } });
  expect((await submitOrder(restarted.adapter, intent("cross-process-1", "1"), { now })).status).toBe("not-submitted");
});

it("reserves funds, posts exact partial fills, and releases only the unfilled reservation on cancel", async () => {
  const path = root(), paper = service(path), order = intent();
  expect(await submitOrder(paper.adapter, order, { now })).toMatchObject({ status: "submitted", order: { status: "open" } });
  expect(await paper.adapter.account(new AbortController().signal)).toMatchObject({ balances: [{ cash: "100", availableCash: "80" }] });
  const reference = { clientOrderId: order.clientOrderId, intentHash: prepareOrderIntent(order, target).intentHash };
  expect(await paper.recordFill(reference, { id: "trade-1", quantity: "0.5", price: "9", fee: { currency: "USD", amount: "0.1" }, at: 1000 }))
    .toMatchObject({ status: "partially-filled", filledQuantity: "0.5" });
  expect(await paper.adapter.account(new AbortController().signal)).toMatchObject({
    balances: [{ cash: "95.4", availableCash: "80.4" }], positions: [{ quantity: "0.5", availableQuantity: "0.5" }],
  });
  expect(await cancelOrder(paper.adapter, order, { now })).toMatchObject({ status: "resolved", order: { status: "cancelled", filledQuantity: "0.5", fills: [{ id: "trade-1" }] } });
  const restarted = service(path);
  expect(await lookupOrder(restarted.adapter, order)).toMatchObject({ status: "found", order: { status: "cancelled", filledQuantity: "0.5" } });
  expect(await restarted.adapter.account(new AbortController().signal)).toMatchObject({ balances: [{ cash: "95.4", availableCash: "95.4" }] });
  await expect(paper.recordFill(reference, { id: "too-late", quantity: "0.1", price: "9", fee: { currency: "USD", amount: "0" }, at: 1000 }))
    .rejects.toThrow("not fillable");
});

it("does not change local paper cash for a fill with unknown fees", async () => {
  const paper = service(root()), order = intent("unknown-fee");
  expect((await submitOrder(paper.adapter, order, { now })).status).toBe("submitted");
  const reference = { clientOrderId: order.clientOrderId, intentHash: prepareOrderIntent(order, target).intentHash };
  await expect(paper.recordFill(reference, { id: "unknown-fee-fill", quantity: "1", price: "9", fee: null, at: 1000 }))
    .rejects.toThrow("known fill fee");
  expect(await paper.adapter.account(new AbortController().signal)).toMatchObject({
    balances: [{ cash: "100", availableCash: "80" }], positions: [] });
});

it("posts a sell only at or above its limit and rejects duplicate fills without changing the ledger", async () => {
  const path = root(), paper = createLocalPaperService({ root: path, target,
    openingAccount: { balances: [{ currency: "USD", cash: "0" }], positions: [{ instrument: intent().instrument, quantity: "2" }] }, now });
  const order: OrderIntent = { ...intent("sell-1", "1"), side: "sell" };
  expect((await submitOrder(paper.adapter, order, { now })).status).toBe("submitted");
  expect((await submitOrder(paper.adapter, { ...intent("too-many", "2"), side: "sell" }, { now })).status).toBe("not-submitted");
  const reference = { clientOrderId: order.clientOrderId, intentHash: prepareOrderIntent(order, target).intentHash };
  const fill = { id: "sell-trade-1", quantity: "0.5", price: "11", fee: { currency: "USD", amount: "0.05" }, at: 1000 };
  await expect(paper.recordFill(reference, { ...fill, price: "9" })).rejects.toThrow("limit price");
  expect(await paper.recordFill(reference, fill)).toMatchObject({ status: "partially-filled", filledQuantity: "0.5" });
  await expect(paper.recordFill(reference, fill)).rejects.toThrow("Duplicate fill ID");
  expect(await lookupOrder(paper.adapter, order)).toMatchObject({ status: "found", order: { filledQuantity: "0.5", fills: [{ id: "sell-trade-1" }] } });
  expect(await paper.recordFill(reference, { ...fill, id: "sell-trade-2" })).toMatchObject({ status: "filled", filledQuantity: "1" });
  expect(await paper.adapter.account(new AbortController().signal)).toMatchObject({ balances: [{ cash: "10.9", availableCash: "10.9" }],
    positions: [{ quantity: "1", availableQuantity: "1" }] });
});

it("serializes competing orders so two clients cannot spend the same paper cash", async () => {
  const path = root(), first = service(path, "20"), second = service(path, "20");
  const outcomes = await Promise.all([submitOrder(first.adapter, intent("first"), { now }), submitOrder(second.adapter, intent("second"), { now })]);
  expect(outcomes.filter(outcome => outcome.status === "submitted")).toHaveLength(1);
  expect(await first.adapter.account(new AbortController().signal)).toMatchObject({ balances: [{ cash: "20", availableCash: "0" }] });
  const ledger = JSON.parse(readFileSync(join(path, "orders.json"), "utf8")) as { body: { orders: unknown[] } };
  expect(ledger.body.orders).toHaveLength(1);
});

it("fails closed on a damaged ledger and never invents a fresh order after read failure", async () => {
  const path = root(), paper = service(path), order = intent();
  expect((await submitOrder(paper.adapter, order, { now })).status).toBe("submitted");
  const file = join(path, "orders.json"), original = readFileSync(file, "utf8");
  writeFileSync(file, original.replace('"cash": "100"', '"cash": "999"'));
  expect(await lookupOrder(paper.adapter, order)).toEqual({ status: "unknown" });
  expect((await submitOrder(paper.adapter, intent("new-order"), { now })).status).not.toBe("submitted");
  expect(readFileSync(file, "utf8")).toContain('"cash": "999"');
});

it("keeps live mode and exchange-specific order lifetimes outside the local paper service", async () => {
  const path = root();
  expect(() => createLocalPaperService({ root: path, target: { ...target, mode: "live" } })).toThrow("live mode");
  const paper = service(path);
  expect((await submitOrder(paper.adapter, { ...intent(), timeInForce: "ioc" }, { now })).status).toBe("not-submitted");
  expect((await submitOrder(paper.adapter, { ...intent(), timeInForce: "day" }, { now })).status).toBe("not-submitted");
});
