import { expect, test } from "bun:test";
import { prepareOrderIntent } from "../../execution/index.ts";
import { reviewedByTerminal, type PaperAgentTerminal } from "../paper-agent-command.ts";

const target = { adapterId: "local-paper", accountRef: "private-review", mode: "paper" as const };
const prepared = prepareOrderIntent({ version: 1, target, clientOrderId: "review-1",
  instrument: { symbol: "AAPL", venue: "NASDAQ", currency: "USD" }, side: "buy", type: "limit",
  quantity: "2", limitPrice: "10", maxOrderNotional: "20", timeInForce: "gtc" }, target);
const account = { target, observedAt: Date.now(), balances: [{ currency: "USD", cash: "100", availableCash: "100" }], positions: [] };
const preflight = { status: "ready" as const, intentHash: prepared.intentHash, checkedAt: Date.now(), expiresAt: Date.now() + 5000 };

test("terminal review requires an action, order ID and hash phrase entered by the human channel", async () => {
  const text: string[] = [], prompts: string[] = [];
  let answer = "yes";
  const terminal: PaperAgentTerminal = { write: value => text.push(value), async question(prompt) { prompts.push(prompt); return answer; } };
  const review = reviewedByTerminal(terminal);
  const request = { action: "submit" as const, prepared, account, preflight };
  expect(await review(request, new AbortController().signal)).toBeNull();
  expect(text[0]).toContain("Paper submit review · account private-review · review-1");
  expect(text[0]).toContain("BUY 2 AAPL @ 10 USD");
  expect(prompts[0]).toContain(`approve submit review-1 ${prepared.intentHash.slice(0, 12)}`);
  answer = `approve submit review-1 ${prepared.intentHash.slice(0, 12)}`;
  const grant = await review(request, new AbortController().signal);
  expect(grant).toMatchObject({ action: "submit", intentHash: prepared.intentHash });
  expect(grant!.expiresAt).toBeGreaterThan(Date.now());
  answer = `approve submit review-1 ${prepared.intentHash.slice(0, 12)}`;
  expect(await review({ action: "cancel", prepared, account }, new AbortController().signal)).toBeNull();
  expect(prompts.at(-1)).toContain(`approve cancel review-1 ${prepared.intentHash.slice(0, 12)}`);
});

test("an aborted review never prompts or returns an approval", async () => {
  let questions = 0;
  const review = reviewedByTerminal({ write() {}, async question() { questions++; return "yes"; } });
  const controller = new AbortController(); controller.abort(new Error("Stopped"));
  await expect(review({ action: "submit", prepared, account, preflight }, controller.signal)).rejects.toThrow("Stopped");
  expect(questions).toBe(0);
});
