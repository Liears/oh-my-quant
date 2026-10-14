import { expect, test } from "bun:test";
import type { ResearchState } from "../../research/state.ts";
import { auditCurrentFactorAnswer } from "../evidence/factor-answer-evidence.ts";

function state(factor = "momentum", period = 2): ResearchState {
  const parameters = { symbol: "AAPL", factor, period, start: "2026-01-01", end: "2026-02-09" };
  const evidence = { callId: "factor", callEntryId: "entry" };
  return { task: { status: "complete", spec: { scope: { symbols: ["AAPL"], market: "US", start: parameters.start, end: parameters.end },
    criteria: [{ id: "latest", tool: "compute_factor", parameters }] },
    criteria: [{ id: "latest", status: "satisfied", evidence }] },
    operations: [{ ...evidence, tool: "compute_factor", parameters, status: "verified",
      findings: { kind: "factor", metrics: [{ label: "Latest", value: 0.1, unit: "number" }] } }] } as unknown as ResearchState;
}

test("retains the real momentum minimum-observation explanation as a violation", () => {
  const original = "- momentum(2)，Latest 0.1（number）：近 2 个收盘价的滞后收益率。适用：窗口内至少 2 个连续收盘可用。";
  expect(auditCurrentFactorAnswer(state(), original).violations).toEqual(["wrong-factor-close-observation-minimum"]);
});

test.each(["momentum", "reversal", "volatility", "rsi"])("%s needs one more close than return intervals", factor => {
  expect(auditCurrentFactorAnswer(state(factor), `${factor}(2) 需要 2 个连续收盘观测。`).violations)
    .toEqual(["wrong-factor-close-observation-minimum"]);
  expect(auditCurrentFactorAnswer(state(factor), `${factor}(2) 需要 3 个连续收盘观测。`).violations).toEqual([]);
});

test.each([
  "momentum(2) requires at least 2 consecutive closing observations.",
  "momentum(2) 至少 1 个收盘价即可。",
])("rejects the explicit insufficient close count: %s", text => {
  expect(auditCurrentFactorAnswer(state(), text).violations).toEqual(["wrong-factor-close-observation-minimum"]);
});

test.each([
  "momentum(2) 需要 2 个收益区间、3 个收盘观测。",
  "momentum(2) 至少 4 个连续收盘观测。",
  "momentum(2) 需要多少个收盘观测未知。",
  "momentum(5) 需要 5 个连续收盘观测。",
  "错误示例：momentum(2) 需要 2 个连续收盘观测。",
  "> momentum(2) 需要 2 个连续收盘观测。",
  "momentum(2) 的说法“需要 2 个连续收盘观测”不正确。",
])("keeps periods, return intervals and quoted counterexamples separate: %s", text => {
  expect(auditCurrentFactorAnswer(state(), text).violations).toEqual([]);
});

test("volume observations are not treated as closing-return intervals", () => {
  expect(auditCurrentFactorAnswer(state("volume_ratio", 20), "volume_ratio(20) 需要 20 个成交量观测。").violations).toEqual([]);
});

test("only the current independently verified calculation supplies the period", () => {
  const current = state(); current.operations[0]!.status = "unverified";
  expect(auditCurrentFactorAnswer(current, "momentum(2) 需要 2 个连续收盘观测。"))
    .toEqual({ status: "unavailable", violations: [] });
});
