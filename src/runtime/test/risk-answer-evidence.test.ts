import { expect, it } from "bun:test";
import type { ResearchState } from "../../research/state.ts";
import { hasRiskMetricLabel, parseRiskMetricClaims, riskMetricClaimViolations } from "../evidence/risk-answer-claims.ts";
import { auditCurrentRiskAnswer } from "../evidence/risk-answer-evidence.ts";

it("rejects the retained real answer's standard-deviation definition against the current risk operation", () => {
  const text = "年化波动率与下行波动率是日收益标准差乘 √252 的年化结果。";
  expect(auditCurrentRiskAnswer(currentState(), text))
    .toEqual({ status: "audited", violations: ["wrong-verified-downside-method"] });
  const state = currentState();
  state.task!.status = "active";
  expect(auditCurrentRiskAnswer(state, text)).toEqual({ status: "not-risk", violations: [] });
});

it.each(["下行偏差是负收益的标准差。", "Downside deviation is the standard deviation of negative returns."])("checks explicit downside method claims: %s", text => {
  expect(hasRiskMetricLabel(text)).toBe(true);
  expect(auditCurrentRiskAnswer(currentState(), text).violations).toEqual(["wrong-verified-downside-method"]);
});

it("checks downside deviation aliases numerically against the same selected metric", () => {
  expect(riskMetricClaimViolations("下行偏差 1%；Downside deviation 1%", metrics)).toEqual([]);
  expect(riskMetricClaimViolations("下行偏差 9%；Downside deviation 9%", metrics))
    .toEqual(["wrong-verified-downside-volatility"]);
});

it("reads the retained model's tail suffixes and longest-underwater label without accepting parametric VaR", () => {
  const text = "CVaR 95% (hist) -4%; VaR 95% (单期) -3%\nDD Longest underwater 3 observed periods（连续低于前高的观测数）";
  expect(parseRiskMetricClaims(text, "AAPL")).toEqual([
    { metric: "cvar95", value: -4 }, { metric: "var95", value: -3 }, { metric: "drawdownDuration", value: 3 },
  ]);
  expect(riskMetricClaimViolations(text, metrics)).toEqual([]);
  expect(riskMetricClaimViolations(text.replace("-4%", "-9%"), metrics)).toEqual(["wrong-verified-cvar95"]);
  expect(parseRiskMetricClaims("VaR 95% (norm) -9%; CVaR 95% (norm) -9%", "AAPL")).toEqual([]);
  expect(parseRiskMetricClaims("Longest underwater 3 calendar days", "AAPL")).toEqual([]);
});

it.each([
  "下行偏差不是日收益标准差，是以零为目标、全部 N 期为分母的均方根。",
  "年化波动率是日收益标准差乘 √252；下行波动率以零为目标，不减均值。",
  "Downside deviation is not the standard deviation of negative returns.",
  "有人误称下行波动率是日收益标准差。",
  "如果下行偏差是负收益的标准差，则这组相同负收益得到零；本工具采用全样本零目标口径。",
  "> 下行偏差是负收益的标准差。\n这是错误定义。",
  "错误说法：‘下行波动率是日收益标准差’。本工具使用全部 N 期。",
  "```text\n下行偏差是负收益的标准差。\n```\n以上是反例。",
])("does not reject negation, comparison, conditional or quoted methods: %s", text => {
  expect(auditCurrentRiskAnswer(currentState(), text).violations).toEqual([]);
});

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

it("reads explicit observation units before inline explanations without accepting calendar days", () => {
  const text = "Drawdown duration: 3 periods    最长连续低于前高，按观测期计";
  expect(parseRiskMetricClaims(text, "AAPL")).toEqual([{ metric: "drawdownDuration", value: 3 }]);
  expect(riskMetricClaimViolations(text.replace("3 periods", "4 periods"), metrics))
    .toEqual(["wrong-verified-drawdown-duration"]);
  expect(parseRiskMetricClaims("回撤持续期 3 个观察期 最长低于前高", "AAPL"))
    .toEqual([{ metric: "drawdownDuration", value: 3 }]);
  for (const value of ["3 days", "3.5 periods", "3%", "3 periodsExtra", "3 calendar days"]) {
    expect(parseRiskMetricClaims(`Drawdown duration ${value}`, "AAPL")).toEqual([]);
  }
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
