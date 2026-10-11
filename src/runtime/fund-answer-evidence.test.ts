import { expect, it } from "bun:test";
import type { ResearchState } from "../research/state.ts";
import { auditCurrentFundAnswer, verifiedFundMetrics } from "./fund-answer-evidence.ts";

const parameters = { symbol: "270042.OF", start_date: "2026-02-01", end_date: "2026-03-01", invest_amount: 100,
  frequency: "monthly", invest_day: 1, purchase_fee_rate: 0, purchase_fee_unit: "decimal" };
function state(overrides: { operationAmount?: number; criterionAmount?: number; secondPrincipal?: number; mixedTool?: boolean } = {}): ResearchState {
  const labels = ["Principal return", "Time-weighted return", "Maximum drawdown (TWR)"];
  const criteria = labels.map((label, index) => ({ id: `c${index + 1}`, tool: overrides.mixedTool && index === 2 ? "check_risk" : "fund_dca_backtest",
    parameters: { ...parameters, invest_amount: overrides.criterionAmount && index === 2 ? overrides.criterionAmount : 100 }, metrics: [label] }));
  const operation = (principal: number) => ({ tool: "fund_dca_backtest", status: "verified",
    parameters: { ...parameters, symbol: "270042", invest_amount: overrides.operationAmount ?? 100 },
    findings: { metrics: [{ label: "Principal return", value: principal }, { label: "Time-weighted return", value: 0.5 },
      { label: "Maximum drawdown (TWR)", value: 0 }] } });
  return { task: { status: "complete", spec: { criteria } }, operations: [operation(0.25),
    ...(overrides.secondPrincipal === undefined ? [] : [operation(overrides.secondPrincipal)])] } as unknown as ResearchState;
}

it("audits all three fund criteria from the same current verified operation", () => {
  expect(auditCurrentFundAnswer(state(), "Principal return 20.00%; Time-weighted return 50.00%; Maximum drawdown (TWR) 0.00%"))
    .toEqual({ status: "audited", violations: ["wrong-verified-principal-return"] });
  expect(auditCurrentFundAnswer(state(), "本金收益率 25%；时间加权收益率 50%；最大回撤 0%"))
    .toEqual({ status: "audited", violations: [] });
  expect(auditCurrentFundAnswer(state(), "Principal return 25.00% （末期模拟市值 200 − 投入 200 本金）/ 200"))
    .toEqual({ status: "audited", violations: ["wrong-fixed-principal-formula"] });
});

it("does not borrow evidence from a different investment or contradictory duplicate", () => {
  expect(auditCurrentFundAnswer(state({ operationAmount: 200 }), "Principal return 20%"))
    .toEqual({ status: "unavailable", violations: [] });
  expect(verifiedFundMetrics(state({ secondPrincipal: 0.2 }), parameters)).toBeNull();
  expect(auditCurrentFundAnswer(state({ criterionAmount: 200 }), "Principal return 20%"))
    .toEqual({ status: "not-fund", violations: [] });
  expect(auditCurrentFundAnswer(state({ mixedTool: true }), "Principal return 20%"))
    .toEqual({ status: "not-fund", violations: [] });
});
