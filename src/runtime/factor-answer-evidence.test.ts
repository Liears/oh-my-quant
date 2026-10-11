import { expect, it } from "bun:test";
import type { ResearchState } from "../research/state.ts";
import { auditCurrentFactorAnswer } from "./factor-answer-evidence.ts";

const parameters = { symbol: "AAPL", factor: "momentum", period: 2, start: "2026-01-01", end: "2026-02-09" };
function state(overrides: { operationPeriod?: number; status?: string; extraTool?: string } = {}): ResearchState {
  const evidence = { callId: "selected", callEntryId: "selected-entry" };
  return { task: { status: "complete", spec: { scope: { symbols: ["AAPL"], market: "US",
    start: "2026-01-01", end: "2026-02-09" }, criteria: [
    { id: "latest", tool: "compute_factor", parameters },
    { id: "risk", tool: overrides.extraTool ?? "check_risk", parameters: { symbol: "AAPL" } }] },
  criteria: [{ id: "latest", status: "satisfied", evidence }] },
  operations: [{ ...evidence, tool: "compute_factor", status: overrides.status ?? "verified",
    parameters: { ...parameters, period: overrides.operationPeriod ?? 2 }, findings: { kind: "factor",
      metrics: [{ label: "Latest", value: 139 / 137 - 1, unit: "number" }] } }] } as unknown as ResearchState;
}

it("audits only a completed factor task with matching verified evidence", () => {
  const claim = "动量分位 0%，属短周期均值回归型特征。";
  expect(auditCurrentFactorAnswer(state(), claim)).toEqual({ status: "audited", violations: ["unsupported-mean-reversion-claim"] });
  expect(auditCurrentFactorAnswer(state(), "动量分位 0% 不构成均值回归证据。"))
    .toEqual({ status: "audited", violations: [] });
  expect(auditCurrentFactorAnswer(state(), "Latest 0.0946；年化波动率 1.30%。"))
    .toEqual({ status: "audited", violations: ["wrong-verified-factor-latest"] });
  expect(auditCurrentFactorAnswer(state({ operationPeriod: 5 }), claim)).toEqual({ status: "unavailable", violations: [] });
  expect(auditCurrentFactorAnswer(state({ status: "unverified" }), claim)).toEqual({ status: "unavailable", violations: [] });
  expect(auditCurrentFactorAnswer(state({ extraTool: "run_backtest" }), claim)).toEqual({ status: "not-factor", violations: [] });
  const stale = state();
  stale.operations.unshift({ ...structuredClone(stale.operations[0]!), callId: "old", callEntryId: "old-entry" });
  stale.task!.criteria[0]!.evidence = { callId: "missing", callEntryId: "missing-entry" };
  expect(auditCurrentFactorAnswer(stale, claim)).toEqual({ status: "unavailable", violations: [] });
  const split = state();
  split.task!.spec.criteria.push({ ...structuredClone(split.task!.spec.criteria[0]!), id: "mean", metrics: ["Prior mean"] });
  split.task!.criteria.push({ ...structuredClone(split.task!.criteria[0]!), id: "mean" });
  expect(auditCurrentFactorAnswer(split, "Latest 0.0146")).toEqual({ status: "audited", violations: [] });
});
