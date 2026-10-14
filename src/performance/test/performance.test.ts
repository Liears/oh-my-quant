import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { calculateAccountPerformance, readAccountPerformance } from "../index.ts";
import type { AccountHistory, AccountHistoryAdapter } from "../index.ts";
import { accountHistoryFixture as fixture } from "./fixture.ts";

const startAt = Date.parse("2025-01-01T00:00:00Z"), middle = Date.parse("2025-06-01T00:00:00Z"), endAt = Date.parse("2026-01-01T00:00:00Z");
let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => { network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Synthetic adapter only")); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); network.mockRestore(); });

test("hand ledger: +10%, deposit 100, -10% links to -1%, with net profit -11 and fees counted once", () => {
  const result = calculateAccountPerformance(fixture());
  expect(result).toMatchObject({ visibility: "private-live-only", verification: "input-consistency-only", openingEquity: 100, closingEquity: 189,
    netExternalFlow: 100, netProfit: -11, feesAlreadyDeducted: 2 });
  expect(result.timeWeightedReturn).toBeCloseTo(-0.01, 12);
  expect(result.observedMaxDrawdown).toBeCloseTo(-0.1, 12);
  expect(result.points.map(point => point.at)).toEqual([startAt, middle, endAt]);
  expect(result.points[0]?.periodReturn).toBeNull();
  expect(result.points[1]?.unitEquity).toBeCloseTo(1.1, 12);
  expect(result.points[2]?.unitEquity).toBeCloseTo(0.99, 12);
  expect(result).not.toHaveProperty("sharpe"); expect(result).not.toHaveProperty("annualVol");
});

test.each([100, -50])("cash flow %s without investment performance must return zero", flow => {
  const history = fixture();
  history.valuations[1]!.equityBeforeFlow = 100; history.valuations[2]!.equityBeforeFlow = 100 + flow;
  history.externalFlows[0]!.amount = flow; history.fees = [];
  const result = calculateAccountPerformance(history);
  expect(result.timeWeightedReturn).toBe(0); expect(result.netProfit).toBe(0); expect(result.observedMaxDrawdown).toBe(0);
});

test("net equity already includes fees; a fee is not an external withdrawal or a second deduction", () => {
  const history = fixture();
  history.valuations = [{ at: startAt, equityBeforeFlow: 100 }, { at: endAt, equityBeforeFlow: 98 }];
  history.externalFlows = [];
  const result = calculateAccountPerformance(history);
  expect(result.netProfit).toBe(-2); expect(result.feesAlreadyDeducted).toBe(2);
  expect(result.timeWeightedReturn).toBeCloseTo(-0.02, 12);
});

test("flows sharing one instant aggregate once; end-boundary withdrawal does not create a drawdown", () => {
  const history = fixture();
  history.externalFlows = [{ id: "in", at: middle, amount: 200 }, { id: "out", at: middle, amount: -100 }, { id: "closing-out", at: endAt, amount: -189 }];
  const result = calculateAccountPerformance(history);
  expect(result.closingEquity).toBe(0); expect(result.netExternalFlow).toBe(-89); expect(result.netProfit).toBe(-11);
  expect(result.timeWeightedReturn).toBeCloseTo(-0.01, 12); expect(result.observedMaxDrawdown).toBeCloseTo(-0.1, 12);
});

test("missing valuations at a flow or either requested boundary fail instead of approximating", () => {
  const history = fixture(); history.valuations.splice(1, 1);
  expect(() => calculateAccountPerformance(history)).toThrow("valuation at every external flow");
  for (const index of [0, 2]) {
    const missing = fixture(); missing.valuations[index]!.at += index ? -1 : 1;
    expect(() => calculateAccountPerformance(missing)).toThrow("exact requested boundaries");
  }
});

test.each(["externalFlows", "fees"] as const)("incomplete %s cannot become an empty valid ledger", field => {
  const history = fixture(); history.coverage[field] = "incomplete";
  expect(() => calculateAccountPerformance(history)).toThrow("Complete external-flow and fee coverage");
  history.coverage[field] = "unknown";
  expect(() => calculateAccountPerformance(history)).toThrow("missing records cannot be treated as zero");
});

test("duplicate, overlapping or out-of-range event IDs and nonfinite amounts are rejected", () => {
  const duplicate = fixture(); duplicate.externalFlows.push({ ...duplicate.externalFlows[0]! });
  expect(() => calculateAccountPerformance(duplicate)).toThrow("unique IDs");
  const feeAsFlow = fixture(); feeAsFlow.fees[0]!.id = feeAsFlow.externalFlows[0]!.id;
  expect(() => calculateAccountPerformance(feeAsFlow)).toThrow("unique IDs");
  for (const at of [startAt, endAt + 1]) {
    const outside = fixture(); outside.externalFlows[0]!.at = at;
    expect(() => calculateAccountPerformance(outside)).toThrow("valid interval");
  }
  for (const amount of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = fixture(); invalid.externalFlows[0]!.amount = amount;
    expect(() => calculateAccountPerformance(invalid)).toThrow("valid interval");
  }
});

test("duplicate and unsorted valuations, unknown fields and invalid reporting bases are rejected", () => {
  const duplicate = fixture(); duplicate.valuations[1]!.at = startAt;
  expect(() => calculateAccountPerformance(duplicate)).toThrow("ordered, unique");
  const unsorted = fixture(); unsorted.valuations.reverse();
  expect(() => calculateAccountPerformance(unsorted)).toThrow("ordered, unique");
  expect(() => calculateAccountPerformance({ ...fixture(), positions: [] } as AccountHistory)).toThrow("fields");
  expect(() => calculateAccountPerformance({ ...fixture(), equityBasis: "before-fees" } as unknown as AccountHistory)).toThrow("net-of-fees basis");
  const stale = fixture(); stale.source.observedAt = startAt;
  expect(() => calculateAccountPerformance(stale)).toThrow("source");
});

test("zero terminal equity is a real total loss; depleted/restarted intermediate capital is not silently linked", () => {
  const loss = fixture(); loss.valuations[2]!.equityBeforeFlow = 0;
  expect(calculateAccountPerformance(loss).timeWeightedReturn).toBe(-1);
  expect(calculateAccountPerformance(loss).observedMaxDrawdown).toBe(-1);
  for (const amount of [-110, -111]) {
    const history = fixture(); history.externalFlows[0]!.amount = amount;
    expect(() => calculateAccountPerformance(history)).toThrow("capital is exhausted, negative");
  }
  const restart = fixture(); restart.valuations[1]!.equityBeforeFlow = 0;
  expect(() => calculateAccountPerformance(restart)).toThrow("positive before the final instant");
});

test("outputs are independent of caller mutations and reject numeric overflow", () => {
  const history = fixture(), before = structuredClone(history), result = calculateAccountPerformance(history);
  expect(history).toEqual(before);
  history.request.accountRef = "changed"; history.source.reference = "changed"; history.valuations[1]!.equityBeforeFlow = 999;
  expect(result.request.accountRef).toBe("synthetic-account"); expect(result.source.reference).toBe("synthetic-complete-statement");
  const overflow = fixture(); overflow.valuations[0]!.equityBeforeFlow = Number.MIN_VALUE;
  expect(() => calculateAccountPerformance(overflow)).toThrow("numeric range");
});

test("a small positive final equity is not rounded into a zero unit curve through return subtraction", () => {
  const history = fixture(); history.externalFlows = []; history.fees = [];
  history.valuations = [{ at: startAt, equityBeforeFlow: 1e14 }, { at: endAt, equityBeforeFlow: 0.01 }];
  const result = calculateAccountPerformance(history);
  expect(result.points[1]!.unitEquity).toBe(1e-16);
  expect(result.closingEquity).toBe(0.01);
});

test("read adapter receives one fixed scope and caller cancellation signal; caller edits do not change it", async () => {
  const history = fixture(), input = structuredClone(history.request), signal = AbortSignal.timeout(2000);
  let calls = 0;
  const adapter: AccountHistoryAdapter = { id: history.source.adapterId, accountRef: input.accountRef,
    async readHistory(request, incoming) {
      calls++; expect(incoming).toBe(signal); expect(request).toEqual(history.request);
      input.currency = "CNY"; input.accountRef = "caller-changed";
      request.currency = "HKD"; // The adapter cannot rewrite the captured request by changing its argument.
      return history;
    } };
  const result = await readAccountPerformance(adapter, input, signal);
  expect(calls).toBe(1); expect(result.request).toEqual(history.request); expect(result.request.currency).toBe("USD");
});

test.each(["account", "currency", "interval", "provider", "target-switch", "future"])("read rejects %s response mismatch", async kind => {
  const history = fixture(), input = structuredClone(history.request);
  const adapter: AccountHistoryAdapter = { id: history.source.adapterId, accountRef: input.accountRef, async readHistory() {
    if (kind === "account") history.request.accountRef = "another-account";
    if (kind === "currency") history.request.currency = "CNY";
    if (kind === "interval") history.request.endAt -= 1;
    if (kind === "provider") history.source.adapterId = "another-provider";
    if (kind === "target-switch") Object.assign(adapter, { accountRef: "another-account" });
    if (kind === "future") history.source.observedAt = Date.now() + 60_000;
    return history;
  } };
  await expect(readAccountPerformance(adapter, input, AbortSignal.timeout(2000))).rejects.toThrow(kind === "future" ? "future" : "identity or interval changed");
});

test("pre-cancel and wrong-account requests never call the adapter", async () => {
  const history = fixture(); let calls = 0;
  const adapter: AccountHistoryAdapter = { id: history.source.adapterId, accountRef: history.request.accountRef, async readHistory() { calls++; return history; } };
  await expect(readAccountPerformance(adapter, history.request, AbortSignal.abort(new Error("cancelled")))).rejects.toThrow("cancelled");
  await expect(readAccountPerformance(adapter, { ...history.request, accountRef: "another" }, AbortSignal.timeout(2000))).rejects.toThrow("does not match");
  expect(calls).toBe(0);
});

test("cancellation stops observing a hung adapter and consumes its later rejection", async () => {
  const history = fixture(), controller = new AbortController(); let rejectLate!: (error: Error) => void;
  const adapter: AccountHistoryAdapter = { id: history.source.adapterId, accountRef: history.request.accountRef,
    readHistory() { return new Promise((_resolve, reject) => { rejectLate = reject; }); } };
  const pending = readAccountPerformance(adapter, history.request, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("Account history read cancelled");
  rejectLate(new Error("synthetic late private error"));
  await Promise.resolve();
});

test("adapter errors are sanitized; an unavailable statement is not a zero return", async () => {
  const history = fixture();
  const adapter: AccountHistoryAdapter = { id: history.source.adapterId, accountRef: history.request.accountRef,
    async readHistory() { throw new Error("synthetic-secret in upstream request"); } };
  await expect(readAccountPerformance(adapter, history.request, AbortSignal.timeout(2000))).rejects.toThrow("Account history read failed; no account result was saved.");
});
