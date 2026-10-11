import { expect, it } from "bun:test";
import type { ResearchState } from "../research/state.ts";
import { portfolioMetricClaimViolations } from "./portfolio-answer-claims.ts";
import { auditCurrentPortfolioAnswer } from "./portfolio-answer-evidence.ts";

const metrics = { groups: [
  { name: "Core", totalReturn: 0.39, maxDrawdown: -0.08 },
  { name: "Stable", totalReturn: 0, maxDrawdown: 0 },
] } as const;

function currentState(): ResearchState {
  const parameters = { group_a: "group-a", group_b: "group-b", start: "2026-01-01", end: "2026-02-09", benchmark: "SPY" };
  const evidence = { callId: "selected", callEntryId: "entry-selected" };
  const spec = { id: "comparison", request: "Compare Core and Stable", goal: "Compare", scope: {
    symbols: ["AAPL", "MSFT"], market: "US" as const, start: "2026-01-01", end: "2026-02-09", benchmark: "SPY",
    portfolioRevision: "revision-1", groupIds: ["group-a", "group-b"] },
    constraints: { allowedTools: ["compare_portfolios"], notes: [] }, dataRefs: [], reportRequired: false,
    criteria: [{ id: "returns", description: "returns", tool: "compare_portfolios", parameters, metrics: ["Portfolio A / Total return"] },
      { id: "drawdowns", description: "drawdowns", tool: "compare_portfolios", parameters, metrics: ["Portfolio B / Max drawdown"] }] };
  const operation = { ...evidence, resultEntryId: "result-selected", requestEntryId: "request", tool: "compare_portfolios", parameters,
    status: "verified" as const, reason: "verified", references: [], findings: { kind: "portfolio-comparison" as const, title: "comparison",
      assumptions: [], metrics: [
        { label: "Portfolio A / Total return", value: 0.39, unit: "percent" as const },
        { label: "Portfolio B / Total return", value: 0, unit: "percent" as const },
        { label: "Portfolio A / Max drawdown", value: -0.08, unit: "percent" as const },
        { label: "Portfolio B / Max drawdown", value: 0, unit: "percent" as const },
      ] }, comparison: { id: "comparison-1", portfolioRevision: "revision-1",
      groups: [{ id: "group-a", name: "Core", members: ["AAPL"] }, { id: "group-b", name: "Stable", members: ["MSFT"] }],
      start: "2026-01-01", end: "2026-02-09", benchmark: "SPY", baseCurrency: "USD", weighting: "buy-and-hold", series: [] } };
  return { version: 1, leafId: "leaf", requests: [], operations: [operation], reports: [], availableTools: ["compare_portfolios"],
    unresolved: [], exclusions: {}, task: { spec, revision: "task-revision", startedEntryId: "task-start", status: "complete",
      criteria: spec.criteria.map(item => ({ id: item.id, status: "satisfied" as const, reason: "verified", evidence })),
      resolutions: [], unresolved: [], reportRef: null, reasons: [] }, taskErrors: [] } as unknown as ResearchState;
}

it("checks named prose and aligned table rows without treating benchmark or allocation weights as returns", () => {
  expect(portfolioMetricClaimViolations("Core 累计收益 +39.00%，最大回撤 8.00%；Stable 总收益 0.00%，最大回撤 0.00%。基准 SPY +19.50%。", metrics)).toEqual([]);
  const table = `行      组合/基准          成员/权重       累计收益    超额 α    最大回撤 DD
EQ     Core (group-a)     AAPL 100%      +38.00%    +19.50%    8.00%
EQ     Stable (group-b)   MSFT 100%       0.00%    -19.50%    0.00%`;
  expect(portfolioMetricClaimViolations(table, metrics)).toEqual(["wrong-verified-portfolio-a-return"]);
  expect(portfolioMetricClaimViolations("| 组合 | Total return | Max drawdown |\n| Portfolio A | +39.00% | -9.00% |\n| Portfolio B | 0.00% | 0.00% |", metrics))
    .toEqual(["wrong-verified-portfolio-a-drawdown"]);
  expect(portfolioMetricClaimViolations("Core 累计收益率为 +39.00%，最大回撤率 8.00%。Core 累计收益与 SPY 基准 19.50% 不能混同。", metrics))
    .toEqual([]);
  expect(portfolioMetricClaimViolations("EQ Core·AAPL    TR +38.00%   DD 8.00%   α +19.50pp\nEQ Stable·MSFT  TR 0.00%  DD 0.00%", metrics))
    .toEqual(["wrong-verified-portfolio-a-return"]);
  expect(portfolioMetricClaimViolations("Series                    Total return  Max DD  CAGR\nPortfolio A  Core/AAPL            38%      8%   2084%\nPortfolio B  Stable/MSFT           0%      0%      0%", metrics))
    .toEqual(["wrong-verified-portfolio-a-return"]);
  expect(portfolioMetricClaimViolations("EQ  组合          Total return   Max DD   Excess\nA   Core/AAPL         38%          8%     +19.5pp\nB   Stable/MSFT        0%          0%     -19.5pp", metrics))
    .toEqual(["wrong-verified-portfolio-a-return"]);
  expect(portfolioMetricClaimViolations("| Series | TR | DD |\n| Core | 38% | 8% |\n| Stable | 0% | 0% |", metrics))
    .toEqual(["wrong-verified-portfolio-a-return"]);
});

it("uses only the current task's selected verified comparison and fails closed when it is missing", () => {
  const state = currentState();
  state.operations.unshift({ ...structuredClone(state.operations[0]!), callId: "old", callEntryId: "old-entry",
    findings: { ...structuredClone(state.operations[0]!.findings!), metrics: [{ label: "Portfolio A / Total return", value: 0.8, unit: "percent" }] } });
  expect(auditCurrentPortfolioAnswer(state, "Core 总收益 38.00%；Stable 总收益 0.00%"))
    .toEqual({ status: "audited", violations: ["wrong-verified-portfolio-a-return"] });
  for (const criterion of state.task!.spec.criteria) {
    criterion.parameters.group_a = "Core";
    criterion.parameters.group_b = "Stable";
  }
  state.operations[1]!.parameters.group_a = "Core";
  state.operations[1]!.parameters.group_b = "Stable";
  expect(auditCurrentPortfolioAnswer(state, "Core 总收益 39.00%；Stable 总收益 0.00%").status).toBe("audited");
  state.task!.criteria[0]!.evidence = { callId: "missing", callEntryId: "missing-entry" };
  expect(auditCurrentPortfolioAnswer(state, "Core 总收益 39.00%").status).toBe("unavailable");
  state.task!.status = "active";
  expect(auditCurrentPortfolioAnswer(state, "Core 总收益 39.00%").status).toBe("not-portfolio");
});
