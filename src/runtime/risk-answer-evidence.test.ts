import { expect, it } from "bun:test";
import type { ResearchState } from "../research/state.ts";
import { hasRiskMetricLabel, parseRiskMetricClaims, riskMetricClaimViolations } from "./risk-answer-claims.ts";
import { auditCurrentRiskAnswer } from "./risk-answer-evidence.ts";

const metrics = { symbol: "AAPL", annualVolatility: 0.013038293078614618, maxDrawdown: -0.08,
  downsideVolatility: 0.01, var95: -0.03, cvar95: -0.04, drawdownDuration: 3 };

function currentState(): ResearchState {
  const parameters = { symbol: "AAPL", market: "US", start: "2026-01-01", end: "2026-02-09" };
  const evidence = { callId: "selected", callEntryId: "entry-selected" };
  const spec = { id: "risk-task", request: "Check AAPL risk", goal: "Risk", scope: {
    symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
    constraints: { allowedTools: ["check_risk"], notes: [] }, dataRefs: [], reportRequired: false,
    criteria: [{ id: "risk", description: "Risk", tool: "check_risk", parameters,
      metrics: ["Annual volatility", "Maximum drawdown"] }] };
  const operation = { ...evidence, resultEntryId: "result-selected", requestEntryId: "request",
    tool: "check_risk", parameters, status: "verified", reason: "verified", references: [],
    findings: { kind: "risk", title: "AAPL risk", assumptions: [], metrics: [
      { label: "Annual volatility", value: metrics.annualVolatility, unit: "percent" },
      { label: "Maximum drawdown", value: metrics.maxDrawdown, unit: "percent" },
      { label: "Downside volatility", value: metrics.downsideVolatility, unit: "percent" },
      { label: "VaR 95%", value: metrics.var95, unit: "percent" },
      { label: "CVaR 95%", value: metrics.cvar95, unit: "percent" },
      { label: "Drawdown duration", value: metrics.drawdownDuration, unit: "periods" },
    ] } };
  return { version: 1, leafId: "leaf", requests: [], operations: [operation], reports: [], availableTools: ["check_risk"],
    unresolved: [], exclusions: {}, task: { spec, revision: "task-revision", startedEntryId: "task-start",
      status: "complete", criteria: [{ id: "risk", status: "satisfied", reason: "verified", evidence }],
      resolutions: [], unresolved: [], reportRef: null, reasons: [] }, taskErrors: [] } as unknown as ResearchState;
}

it("checks explicit risk percentages in prose and an aligned table without treating other figures as risk", () => {
  expect(riskMetricClaimViolations("Annual volatility 1.3038%; Max DD -8.00%. Downside volatility 1%; VaR 95% -3%.", metrics)).toEqual([]);
  expect(riskMetricClaimViolations("年化波动率：9.00%；最大回撤 8.00%。", metrics))
    .toEqual(["wrong-verified-annual-volatility"]);
  expect(riskMetricClaimViolations("Annual vol: 1.30%; Maximum drawdown 12.00%.", metrics))
    .toEqual(["wrong-verified-risk-drawdown"]);
  expect(riskMetricClaimViolations("| Symbol | Annual volatility | Max DD |\n| AAPL | 9.00% | 8.00% |\n| SPY | 4.00% | 3.00% |", metrics))
    .toEqual(["wrong-verified-annual-volatility"]);
  expect(riskMetricClaimViolations("年化波动率按 252 期估算；最大回撤仅覆盖此窗口。", metrics)).toEqual([]);
});

it("checks downside, signed VaR/CVaR and observation counts without parsing confidence levels as losses", () => {
  const correct = "年化波动率 1.30%；年化下行波动率 1.00%；VaR 95% -3.00%；CVaR 95% -4.00%；最大回撤 8.00%；回撤持续期 3 期。";
  expect(parseRiskMetricClaims(correct, "AAPL")).toHaveLength(6);
  expect(riskMetricClaimViolations(correct, metrics)).toEqual([]);
  expect(riskMetricClaimViolations("Downside vol 9%; VaR 95% +3%; CVaR 95% -9%; Drawdown duration 4 periods", metrics))
    .toEqual(["wrong-verified-downside-volatility", "wrong-verified-var95", "wrong-verified-cvar95", "wrong-verified-drawdown-duration"]);
  expect(parseRiskMetricClaims("VaR 95% is a quantile; CVaR 95% averages the tail; Drawdown duration is not calendar days.", "AAPL")).toEqual([]);
  expect(hasRiskMetricLabel("CVaR 95% -9%")).toBe(true);
  expect(hasRiskMetricLabel("Plain conversation about 95% of observations")).toBe(false);
});

it("keeps blank table cells aligned and ignores another symbol's tail figures", () => {
  const text = "| Symbol | Downside volatility | VaR 95% | CVaR 95% | Drawdown duration |\n|---|---|---|---|---|\n| SPY | 9% | 9% | 9% | 9 |\n| AAPL | | -3% | -4% | 3 |";
  expect(riskMetricClaimViolations(text, metrics)).toEqual([]);
  expect(parseRiskMetricClaims(text, "AAPL").map(claim => claim.metric)).toEqual(["var95", "cvar95", "drawdownDuration"]);
  expect(riskMetricClaimViolations(text.replace("| -4% | 3 |", "| -5% | 4 |"), metrics))
    .toEqual(["wrong-verified-cvar95", "wrong-verified-drawdown-duration"]);
});

it("parses historical VaR labels and observed-period units without conflating parametric VaR", () => {
  const text = "Annual volatility 1.30%\nDownside volatility 1%\nVaR 95% (hist) -3%\nVaR 95% (norm) -8%\nCVaR 95% -4%\nMaximum drawdown -8%\nDrawdown duration 3 observed periods";
  expect(new Set(parseRiskMetricClaims(text, "AAPL").map(item => item.metric)).size).toBe(6);
  expect(riskMetricClaimViolations(text, metrics)).toEqual([]);
  expect(riskMetricClaimViolations(text.replace("(hist) -3%", "(hist) -9%"), metrics)).toEqual(["wrong-verified-var95"]);
  expect(riskMetricClaimViolations(text.replace("3 observed periods", "4 observed periods"), metrics))
    .toEqual(["wrong-verified-drawdown-duration"]);
  expect(parseRiskMetricClaims("回撤持续期 3 个观察期", "AAPL")).toEqual([{ metric: "drawdownDuration", value: 3 }]);
});

it("requires correct units and all risk values from the selected operation", () => {
  for (const label of ["VaR 95%", "CVaR 95%", "Downside volatility", "Drawdown duration"]) {
    const state = currentState();
    state.operations[0]!.findings!.metrics = state.operations[0]!.findings!.metrics.filter(item => item.label !== label);
    expect(auditCurrentRiskAnswer(state, "VaR 95% -3%").status).toBe("unavailable");
  }
  const state = currentState();
  state.operations[0]!.findings!.metrics.find(item => item.label === "VaR 95%")!.unit = "number";
  expect(auditCurrentRiskAnswer(state, "VaR 95% -3%").status).toBe("unavailable");
});

it("uses the current task's selected risk operation and fails closed on mismatched evidence", () => {
  const state = currentState();
  state.operations.unshift({ ...structuredClone(state.operations[0]!), callId: "old", callEntryId: "old-entry",
    findings: { ...structuredClone(state.operations[0]!.findings!), metrics: [
      { label: "Annual volatility", value: 0.09, unit: "percent" },
      { label: "Maximum drawdown", value: -0.08, unit: "percent" },
    ] } });
  expect(auditCurrentRiskAnswer(state, "Annual volatility 9.00%; Max DD 8.00%"))
    .toEqual({ status: "audited", violations: ["wrong-verified-annual-volatility"] });
  state.task!.spec.criteria.push({ ...structuredClone(state.task!.spec.criteria[0]!), id: "drawdown",
    metrics: ["Maximum drawdown"] });
  state.task!.criteria.push({ ...structuredClone(state.task!.criteria[0]!), id: "drawdown" });
  expect(auditCurrentRiskAnswer(state, "Annual volatility 9.00%; Max DD 8.00%"))
    .toEqual({ status: "audited", violations: ["wrong-verified-annual-volatility"] });
  state.task!.criteria[0]!.evidence = { callId: "missing", callEntryId: "missing-entry" };
  expect(auditCurrentRiskAnswer(state, "Annual volatility 1.30%").status).toBe("unavailable");
  state.task!.criteria[0]!.evidence = { callId: "selected", callEntryId: "entry-selected" };
  state.operations[1]!.parameters.start = "2026-01-02";
  expect(auditCurrentRiskAnswer(state, "Annual volatility 1.30%").status).toBe("unavailable");
  state.task!.status = "active";
  expect(auditCurrentRiskAnswer(state, "Annual volatility 1.30%").status).toBe("not-risk");
  state.task!.status = "complete";
  state.task!.spec.scope.symbols.push("MSFT");
  expect(auditCurrentRiskAnswer(state, "Annual volatility 1.30%").status).toBe("not-risk");
});
