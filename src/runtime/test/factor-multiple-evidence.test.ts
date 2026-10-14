import { expect, it } from "bun:test";
import type { ResearchState } from "../../research/state.ts";
import { auditCurrentFactorAnswer } from "../evidence/factor-answer-evidence.ts";
import { factorLatestClaimViolations, hasExplicitFactorLatestClaim } from "../evidence/factor-latest-claims.ts";
import { hasAllFactorLatestClaims } from "../evidence/factor-latest-claims.ts";

const facts = [{ factor: "momentum", period: 2, latest: -13 / 137 }, { factor: "rsi", period: 14, latest: 1300 / 27 }];
function state(): ResearchState {
  const operations = facts.map((fact, index) => ({ callId: `call-${index}`, callEntryId: `entry-${index}`,
    tool: "compute_factor", status: "verified", parameters: { symbol: "AAPL", factor: fact.factor, period: fact.period,
      start: "2026-01-01", end: "2026-02-09" }, findings: { kind: "factor",
      metrics: [{ label: "Latest", value: fact.latest, unit: "number" }] } }));
  return { task: { status: "complete", spec: { scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
    criteria: operations.map((operation, index) => ({ id: `factor-${index}`, tool: "compute_factor", parameters: structuredClone(operation.parameters) })) },
    criteria: operations.map((operation, index) => ({ id: `factor-${index}`, status: "satisfied",
      evidence: { callId: operation.callId, callEntryId: operation.callEntryId } })) }, operations } as unknown as ResearchState;
}

it("binds two factors to separate selected calls without miscomparing their Latest values", () => {
  expect(auditCurrentFactorAnswer(state(), "momentum(2) Latest: -0.09489051\nrsi(14) Latest: 48.14814815"))
    .toEqual({ status: "audited", violations: [] });
  expect(auditCurrentFactorAnswer(state(), "momentum(2) Latest: -0.09489051; rsi(14) Latest: 100").violations)
    .toEqual(["wrong-verified-factor-latest"]);
});

it.each(["unverified", "missing", "duplicate", "period", "date", "market"])("fails closed on %s selected multi-factor evidence", mode => {
  const current = state();
  const operation = current.operations[1]!;
  if (mode === "unverified") operation.status = "unverified";
  if (mode === "missing") current.task!.criteria[1]!.evidence!.callId = "missing";
  if (mode === "duplicate") current.operations.push(structuredClone(operation));
  if (mode === "period") operation.parameters.period = 2;
  if (mode === "date") current.task!.spec.criteria[1]!.parameters.end = "2026-02-08";
  if (mode === "market") current.task!.spec.criteria[1]!.parameters.market = "A";
  expect(auditCurrentFactorAnswer(current, "rsi(14) Latest 48.1481").status).toBe("unavailable");
});

it("deduplicates several metrics selected from the same factor calculation", () => {
  const current = state();
  current.task!.spec.criteria.push({ ...structuredClone(current.task!.spec.criteria[0]!), id: "prior-mean", metrics: ["Prior mean"] });
  current.task!.criteria.push({ ...structuredClone(current.task!.criteria[0]!), id: "prior-mean" });
  expect(auditCurrentFactorAnswer(current, "momentum(2) Latest -9.49%; RSI(14) Latest 48.15").violations).toEqual([]);
});

it("does not merge same-factor same-period results from different observation cutoffs", () => {
  const current = state();
  const extra = structuredClone(current.operations[0]!);
  extra.callId = "new-call"; extra.callEntryId = "new-entry"; extra.parameters.observed_before = "2026-03-01T00:00:00.000Z";
  current.operations.push(extra);
  current.task!.spec.criteria.push({ ...structuredClone(current.task!.spec.criteria[0]!), id: "other-version", parameters: extra.parameters });
  current.task!.criteria.push({ ...structuredClone(current.task!.criteria[0]!), id: "other-version",
    evidence: { callId: extra.callId, callEntryId: extra.callEntryId } });
  expect(auditCurrentFactorAnswer(current, "momentum(2) Latest -0.0949").status).toBe("unavailable");
});

it("requires labels for an otherwise ambiguous Latest while preserving one-factor answers", () => {
  expect(factorLatestClaimViolations("Latest 48.15", facts)).toEqual(["ambiguous-verified-factor-latest"]);
  expect(factorLatestClaimViolations("Latest -0.0949", facts[0]!)).toEqual([]);
});

it("matches an explicit period when several periods of the same factor are selected", () => {
  const periods = [facts[0]!, { factor: "momentum", period: 5, latest: -0.02 }];
  expect(factorLatestClaimViolations("momentum(2) Latest -0.0949\nmomentum_5 Latest -2%", periods)).toEqual([]);
  expect(factorLatestClaimViolations("momentum Latest -2%", periods)).toEqual(["ambiguous-verified-factor-latest"]);
});

it("reads Latest by table column while leaving prior means and foreign factors alone", () => {
  const table = "| Factor | Period | Prior mean | Latest |\n|---|---|---|---|\n| momentum | 2 | 900 | -0.0949 |\n| RSI | 14 | 100 | 48.15 |\n| reversal | 2 | 0 | 99 |";
  expect(hasExplicitFactorLatestClaim(table)).toBe(true);
  expect(factorLatestClaimViolations(table, facts)).toEqual([]);
  expect(factorLatestClaimViolations(table.replace("48.15", "100"), facts)).toEqual(["wrong-verified-factor-latest"]);
});

it("reads factor headings and does not confuse an ordinary Latest/value row with a header", () => {
  expect(factorLatestClaimViolations("### momentum(2)\n| Latest | -0.0949 |\n### rsi(14)\nLatest 48.15", facts)).toEqual([]);
  expect(factorLatestClaimViolations("### momentum(2)\nLatest 100\n### rsi(14)\nLatest 48.15", facts))
    .toEqual(["wrong-verified-factor-latest"]);
  expect(hasExplicitFactorLatestClaim("| Latest | -0.0949 |")).toBe(true);
  expect(hasExplicitFactorLatestClaim("| Latest | 2026-02-09 |")).toBe(false);
});

it("reads the retained Chinese combined factor-period header and compares each value separately", () => {
  const table = "因子(周期)          Latest     均值  分位  单位\nmomentum(2)        -0.0949    0.0171    0%  比率(小数)\nrsi(14)            48.1481  100.0000    0%  指数(0-100)";
  expect(hasAllFactorLatestClaims(table, facts)).toBe(true);
  expect(factorLatestClaimViolations(table, facts)).toEqual([]);
  expect(factorLatestClaimViolations(table.replace("48.1481", "100"), facts)).toEqual(["wrong-verified-factor-latest"]);
});

it("reads compact factor-period rows with an English header without accepting a missing factor", () => {
  const table = "Factor(period) Latest\nmomentum(2) -0.0949\nRSI(14) 48.15";
  expect(hasAllFactorLatestClaims(table, facts)).toBe(true);
  expect(hasAllFactorLatestClaims(table.split("\n").slice(0, -1).join("\n"), facts)).toBe(false);
  expect(factorLatestClaimViolations(table, facts)).toEqual([]);
});

it("binds the retained comma-separated factor label and each subsequent label on the same line", () => {
  const text = "momentum(2)，Latest -0.0949（比率）；rsi(14)，Latest 48.1481（指数）。";
  expect(factorLatestClaimViolations(text, facts)).toEqual([]);
  expect(factorLatestClaimViolations(text.replace("48.1481", "100"), facts)).toEqual(["wrong-verified-factor-latest"]);
  expect(factorLatestClaimViolations("momentum(2) Latest -0.0949，rsi(14) Latest 48.15", facts)).toEqual([]);
  expect(factorLatestClaimViolations("momentum(2) versus rsi(14): Latest 48.15", facts)).toEqual(["ambiguous-verified-factor-latest"]);
});

it("binds the retained numbered factor heading to its later Latest explanation", () => {
  const selected = [{ factor: "reversal", period: 2, latest: 13 / 137 }, facts[1]!];
  const text = "2. reversal(2)\n口径：动量取负。\n失效：Latest 0.0949 仅为构造值。\n\n5. rsi(14)\nLatest 48.1481";
  expect(factorLatestClaimViolations(text, selected)).toEqual([]);
  expect(factorLatestClaimViolations(text.replace("48.1481", "100"), selected)).toEqual(["wrong-verified-factor-latest"]);
  expect(factorLatestClaimViolations("rsi(14)\nLatest 48.1481", selected)).toEqual([]);
});
