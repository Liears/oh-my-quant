import { expect, it } from "bun:test";
import { riskMethodClaimViolations } from "../evidence/risk-answer-claims.ts";

it("rejects the retained two-volatility shorthand when downside is explicitly in scope", () => {
  const answer = "Annual volatility: 208.29%\nDownside volatility: 160.77%\n单位：两项波动率为日收益样本标准差 × √252 的年化值；VaR/CVaR 是单日收益量纲。";
  expect(riskMethodClaimViolations(answer)).toEqual(["wrong-verified-downside-method"]);
});

it.each([
  "Annual volatility: 208.29%\nDownside volatility: 160.77%\n两项波动率分别为样本标准差和零目标下行偏差，各乘 √252。",
  "Downside volatility: 160.77%\n错误说法：两项波动率为日收益样本标准差 × √252。",
  "AAPL 和 MSFT 的两项波动率为日收益样本标准差 × √252。",
])("keeps correct, refuted or unrelated two-volatility explanations: %s", answer => {
  expect(riskMethodClaimViolations(answer)).toEqual([]);
});

it.each([
  "年化波动率 = sqrt(样本方差 / (N-1)) × sqrt(252)；最大回撤为窗口内最大累计峰谷跌幅。",
  "Annual volatility = sqrt(sample variance / (N - 1)) * sqrt(252).",
  "年化波动率为 √（样本方差 ÷ （N−1））× √252。",
])("rejects an additional sample-variance denominator: %s", text => {
  expect(riskMethodClaimViolations(text)).toEqual(["wrong-verified-annual-volatility-method"]);
});

it.each([
  "年化波动率 = sqrt(样本方差) × sqrt(252)。",
  "Annual volatility = sqrt(sum((r - mean(r))^2) / (N - 1)) * sqrt(252).",
  "年化波动率 = sqrt(总体方差 / (N-1)) × sqrt(252)。",
  "错误公式：年化波动率 = sqrt(样本方差 / (N-1)) × sqrt(252)。",
  "年化波动率 = sqrt(样本方差 / (N-1)) × sqrt(252) 是不正确的。",
  "如果年化波动率 = sqrt(样本方差 / (N-1)) × sqrt(252)，就重复除以 N-1。",
  "> 年化波动率 = sqrt(样本方差 / (N-1)) × sqrt(252)\n以上是反例。",
  "“年化波动率 = sqrt(样本方差 / (N-1)) × sqrt(252)”是错误说法。",
])("keeps the finite method check scoped to an affirmative sample-variance definition: %s", text => {
  expect(riskMethodClaimViolations(text)).toEqual([]);
});

it("retains both independent method contradictions without duplicate codes", () => {
  expect(riskMethodClaimViolations("年化波动率 = sqrt(样本方差 / (N-1)) × sqrt(252)。下行偏差是负收益的标准差。下行偏差是负收益的标准差。"))
    .toEqual(["wrong-verified-annual-volatility-method", "wrong-verified-downside-method"]);
});

it.each([
  "VaR 95%、CVaR 95%、最大回撤均为单期（日）符号收益率，未年化。",
  "最大回撤是单日收益率。",
  "Maximum drawdown is a single-period return.",
])("rejects drawdown as a single-period return: %s", text => {
  expect(riskMethodClaimViolations(text)).toContain("wrong-drawdown-period-method");
});

it.each([
  "最大回撤是窗口内累计峰谷跌幅，不是单期收益率。",
  "VaR、CVaR 是单期收益率；最大回撤是累计峰谷跌幅。",
  "错误说法：最大回撤是单期收益率。",
  "Maximum drawdown is not a single-period return.",
])("keeps correct drawdown wording and counterexamples: %s", text => {
  expect(riskMethodClaimViolations(text)).toEqual([]);
});
