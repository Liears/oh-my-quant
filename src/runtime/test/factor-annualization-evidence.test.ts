import { expect, test } from "bun:test";
import type { ResearchState } from "../../research/state.ts";
import { auditCurrentFactorAnswer } from "../evidence/factor-answer-evidence.ts";

function evidenceState(): ResearchState {
  const parameters = { symbol: "AAPL", factor: "volatility", period: 2, start: "2026-01-01", end: "2026-02-09" };
  const reference = { callId: "selected", callEntryId: "selected-entry" };
  return { task: { status: "complete", spec: { scope: { symbols: ["AAPL"], market: "US",
    start: parameters.start, end: parameters.end }, criteria: [{ id: "latest", tool: "compute_factor", parameters }] },
    criteria: [{ id: "latest", status: "satisfied", evidence: reference }] },
    operations: [{ ...reference, tool: "compute_factor", status: "verified", parameters,
      findings: { kind: "factor", metrics: [{ label: "Latest", value: 0.07689683392148217, unit: "number" }] } }] } as unknown as ResearchState;
}

test("the method check uses the current matched computation and allows a separate conditional convention", () => {
  expect(auditCurrentFactorAnswer(evidenceState(), "因子波动率不能年化。"))
    .toEqual({ status: "audited", violations: ["unsupported-factor-annualization-prohibition"] });
  expect(auditCurrentFactorAnswer(evidenceState(), "因子原值未年化；日频和无自相关假设成立时可另算年化标准差。"))
    .toEqual({ status: "audited", violations: [] });
});

test("unmatched evidence and unrelated tasks cannot be replaced by older factor evidence", () => {
  const missing = evidenceState();
  missing.operations.unshift({ ...structuredClone(missing.operations[0]!), callId: "old", callEntryId: "old-entry" });
  missing.task!.criteria[0]!.evidence = { callId: "missing", callEntryId: "missing-entry" };
  expect(auditCurrentFactorAnswer(missing, "因子波动率不能年化。"))
    .toEqual({ status: "unavailable", violations: [] });
  const unrelated = evidenceState();
  unrelated.task!.spec.criteria[0]!.tool = "run_backtest";
  expect(auditCurrentFactorAnswer(unrelated, "因子波动率不能年化。"))
    .toEqual({ status: "not-factor", violations: [] });
});
