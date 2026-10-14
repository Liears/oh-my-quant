import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createLocalPaperService } from "../index.ts";
import { createReviewedPaperTools, type ReviewPaperOrder } from "../agent-tools.ts";

let root: string;
const target = { adapterId: "local-paper", accountRef: "agent-test", mode: "paper" as const };
const buy = { action: "submit", clientOrderId: "agent-order-1", instrument: { symbol: "AAPL", venue: "NASDAQ", currency: "USD" },
  side: "buy", quantity: "2", limitPrice: "10", maxOrderNotional: "20", timeInForce: "gtc" } as const;
const signal = new AbortController().signal;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "whyj-paper-agent-")); });
afterEach(() => {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected paper Agent test directory.");
  rmSync(root, { recursive: true, force: true });
});

function service() {
  return createLocalPaperService({ root, target, openingAccount: { balances: [{ currency: "USD", cash: "100" }], positions: [] } });
}
function resultStatus(result: Awaited<ReturnType<ReturnType<typeof createReviewedPaperTools>[number]["execute"]>>): string {
  const details = result.details as { outcome?: { status?: string } };
  return details.outcome?.status ?? "missing";
}

test("a model cannot approve its own paper order or change the bound account", async () => {
  const paper = service();
  let reviews = 0;
  const deny: ReviewPaperOrder = async () => { reviews++; return null; };
  const [account, order] = createReviewedPaperTools(paper.adapter, deny);
  await expect(order!.execute("denied", buy, signal)).rejects.toThrow("not approved");
  expect(reviews).toBe(1);
  const absent = await order!.execute("lookup", { ...buy, action: "lookup" }, signal);
  expect(resultStatus(absent)).toBe("not-found");
  await expect(order!.execute("unknown", { ...buy, approved: true }, signal)).rejects.toThrow("model approval flags");
  await expect(order!.execute("switch", { ...buy, target: { ...target, accountRef: "other" } }, signal)).rejects.toThrow("alternate targets");
  expect(reviews).toBe(1);
  await expect(account!.execute("bad", { cash: "1000000" }, signal)).rejects.toThrow("no parameters");
  expect(() => createReviewedPaperTools({ ...paper.adapter, target: { ...target, mode: "live" } }, deny)).toThrow("paper-only");
});

test("host review is bound to the exact action, hash and expiry", async () => {
  const paper = service();
  const wrongHash: ReviewPaperOrder = async request => ({ action: request.action, intentHash: "0".repeat(64), expiresAt: Date.now() + 1000 });
  const tool = createReviewedPaperTools(paper.adapter, wrongHash)[1]!;
  await expect(tool.execute("wrong-hash", buy, signal)).rejects.toThrow("exact intent");
  expect(resultStatus(await tool.execute("absent", { ...buy, action: "lookup" }, signal))).toBe("not-found");
  const expired = createReviewedPaperTools(paper.adapter, async request => ({ action: request.action,
    intentHash: request.prepared.intentHash, expiresAt: Date.now() - 1 }))[1]!;
  await expect(expired.execute("expired", buy, signal)).rejects.toThrow("not approved");
  const wrongAction = createReviewedPaperTools(paper.adapter, async request => ({ action: "cancel",
    intentHash: request.prepared.intentHash, expiresAt: Date.now() + 1000 }))[1]!;
  await expect(wrongAction.execute("wrong-action", buy, signal)).rejects.toThrow("not approved");
  expect(resultStatus(await tool.execute("still-absent", { ...buy, action: "lookup" }, signal))).toBe("not-found");
});

test("approved paper submit, restart lookup and separately reviewed cancel use the durable account", async () => {
  const paper = service();
  const actions: string[] = [];
  const review: ReviewPaperOrder = async request => {
    actions.push(request.action);
    expect(request.prepared.intent.target).toEqual(target);
    expect(request.account.target).toEqual(target);
    return { action: request.action, intentHash: request.prepared.intentHash, expiresAt: Date.now() + 2000 };
  };
  const [account, order] = createReviewedPaperTools(paper.adapter, review);
  expect(resultStatus(await order!.execute("submit", buy, signal))).toBe("submitted");
  expect(actions).toEqual(["submit"]);
  const held = await account!.execute("account", {}, signal);
  expect((held.details as { account: { balances: Array<{ availableCash: string }> } }).account.balances[0]?.availableCash).toBe("80");

  const reopened = createLocalPaperService({ root, target });
  const reopenedOrder = createReviewedPaperTools(reopened.adapter, review)[1]!;
  const found = await reopenedOrder.execute("lookup", { ...buy, action: "lookup" }, signal);
  expect(resultStatus(found)).toBe("found");
  expect(actions).toEqual(["submit"]);
  const deniedCancel = createReviewedPaperTools(reopened.adapter, async request => ({ action: "submit",
    intentHash: request.prepared.intentHash, expiresAt: Date.now() + 1000 }))[1]!;
  await expect(deniedCancel.execute("denied-cancel", { ...buy, action: "cancel" }, signal)).rejects.toThrow("not approved");
  expect(resultStatus(await reopenedOrder.execute("still-found", { ...buy, action: "lookup" }, signal))).toBe("found");
  expect(resultStatus(await reopenedOrder.execute("cancel", { ...buy, action: "cancel" }, signal))).toBe("resolved");
  expect(actions).toEqual(["submit", "cancel"]);
  const released = await reopened.adapter.account(signal);
  expect(released.balances[0]?.availableCash).toBe("100");
});

test("unaffordable orders and missing cancels never request review or mutate the ledger", async () => {
  const paper = service();
  let reviews = 0;
  const order = createReviewedPaperTools(paper.adapter, async request => {
    reviews++; return { action: request.action, intentHash: request.prepared.intentHash, expiresAt: Date.now() + 1000 };
  })[1]!;
  const costly = { ...buy, quantity: "20", maxOrderNotional: "200" };
  expect(resultStatus(await order.execute("costly", costly, signal))).toBe("not-submitted");
  expect(resultStatus(await order.execute("missing-cancel", { ...buy, action: "cancel" }, signal))).toBe("not-found");
  expect(reviews).toBe(0);
  expect((await paper.adapter.account(signal)).balances[0]?.availableCash).toBe("100");
});
