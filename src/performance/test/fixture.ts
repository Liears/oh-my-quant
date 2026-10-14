import type { AccountHistory } from "../types.ts";

/** Synthetic statements only; no IO, actual account, market prices or credentials. */
export function accountHistoryFixture(): AccountHistory {
  const startAt = Date.parse("2025-01-01T00:00:00Z"), middle = Date.parse("2025-06-01T00:00:00Z"), endAt = Date.parse("2026-01-01T00:00:00Z");
  return { version: 1, request: { accountRef: "synthetic-account", currency: "USD", startAt, endAt },
    source: { adapterId: "synthetic-provider", reference: "synthetic-complete-statement", observedAt: endAt + 1000 },
    coverage: { externalFlows: "complete", fees: "complete" }, equityBasis: "after-fees",
    valuations: [{ at: startAt, equityBeforeFlow: 100 }, { at: middle, equityBeforeFlow: 110 }, { at: endAt, equityBeforeFlow: 189 }],
    externalFlows: [{ id: "deposit-1", at: middle, amount: 100 }], fees: [{ id: "fee-1", at: middle, amount: 2 }] };
}
