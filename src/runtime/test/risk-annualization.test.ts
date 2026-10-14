import { expect, it } from "bun:test";
import { metrics, RISK_EVIDENCE_BOUNDARY } from "../../quant/risk.ts";
import { riskMethodClaimViolations } from "../evidence/risk-answer-claims.ts";

it("annualizes both volatility measures with independent zero-target downside arithmetic", () => {
  const risk = metrics([-0.2, 0.1, 0.1]);
  expect(risk.annualVol).toBeCloseTo(Math.sqrt(0.03 * 252), 12);
  expect(risk.downsideVol).toBeCloseTo(Math.sqrt(0.04 / 3 * 252), 12);
  expect(RISK_EVIDENCE_BOUNDARY).toContain("Both annual volatility and downside volatility are annualized by sqrt(252)");
});
it.each([
  "仅年化波动率按 sqrt(252) 年化。",
  "只有年化波动率年化，下行波动率未年化。",
  "下行偏差不年化。",
  "Only annual volatility is annualized.",
  "Downside volatility is not annualized.",
])("rejects an affirmative contradiction of the tool's annualization: %s", text => {
  expect(riskMethodClaimViolations(text)).toEqual(["wrong-verified-risk-annualization"]);
});
it.each([
  "两项波动率均按 √252 年化，年化波动率去均值且分母 N−1，下行偏差以零为目标且分母 N。",
  "并非仅年化波动率按 sqrt(252) 年化，两项都年化。",
  "错误说法：仅年化波动率按 sqrt(252) 年化。",
  "如果下行偏差不年化，这里就无法和年化波动率按相同频率比较。",
  "‘下行偏差不年化’是不正确的。",
  "> Only annual volatility is annualized.\n以上为错误反例。",
  "Factor volatility is not annualized; risk downside volatility is annualized.",
])("keeps correct, quoted, conditional and different-factor methods: %s", text => {
  expect(riskMethodClaimViolations(text)).toEqual([]);
});
