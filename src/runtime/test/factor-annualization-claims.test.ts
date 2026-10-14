import { expect, test } from "bun:test";
import { knownFactorAnswerViolations } from "../evidence/factor-answer-claims.ts";
import { factorEvidenceBoundary } from "../../quant/factor-evidence.ts";

test.each([
  "volatility(2)：日样本标准差不能年化。",
  "日收益率的样本标准差不可乘 sqrt(252) 得到年化波动率。",
  "因子波动率不能乘 √252 换算成年化波动率。",
  "Daily volatility cannot be annualized.",
  "Factor volatility must not be multiplied by the square root of frequency to annualize it.",
  "volatility(2)：2 个日收益率的样本标准差（N-1 分母），未经年化；它不是年化风险指标，不可乘频率因子后当作年化波动；2 日窗口下估计误差极大。",
])("requests review of an unconditional factor annualization prohibition: %s", text => {
  expect(knownFactorAnswerViolations(text)).toEqual(["unsupported-factor-annualization-prohibition"]);
});

test.each([
  "volatility(2) 是日样本标准差，原值未经年化，不能直接当作年化风险。",
  "volatility(2) 在日频和无自相关假设明确时，可以乘 sqrt(252) 换算成年化波动率。",
  "日样本标准差不能乘 252 作为年化波动率；按平方根频率换算需要明确假设。",
  "频率未知时，因子波动率不能年化。",
  "因子波动率不能年化，因为观察频率未验证。",
  "Irregular observations: daily volatility cannot be annualized by this convention.",
  "Daily volatility cannot be annualized without checking observation frequency.",
  "Daily volatility cannot be annualized if returns have autocorrelation.",
  "错误表述：日样本标准差不能年化。",
  "有人声称 daily volatility cannot be annualized, which is incorrect.",
  "“日样本标准差不能年化”是错误说法。",
  "> 日样本标准差不能年化。",
  "volatility(2) 为日波动；RSI 不能年化。",
])("allows raw-value caveats, conditional limits and quoted counterexamples: %s", text => {
  expect(knownFactorAnswerViolations(text)).toEqual([]);
});

test("a conditional caveat cannot cancel a separate unconditional prohibition", () => {
  expect(knownFactorAnswerViolations("频率未知时不能换算，但因子波动率永远不能年化。"))
    .toEqual(["unsupported-factor-annualization-prohibition"]);
});

test("shared volatility evidence gives the square-root convention and its assumptions", () => {
  const boundary = factorEvidenceBoundary("volatility");
  expect(boundary).toContain("sqrt(periodsPerYear)");
  expect(boundary).toContain("uncorrelated");
  expect(boundary).toContain("without annualization here");
});
