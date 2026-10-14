import { expect, it } from "bun:test";
import { maxDrawdown, sharpe } from "../../quant/performance.ts";
import { performanceMethodClaimViolations } from "../evidence/performance-method-claims.ts";

it.each([
  "SPY 的 Sharpe 36.44 源于样本内回撤为零，是描述性估计而非能力证据。",
  "The high Sharpe is due to zero observed drawdown.",
  "夏普比率高是因为零回撤。",
])("rejects the retained false Sharpe cause: %s", answer => {
  expect(performanceMethodClaimViolations(answer)).toEqual(["wrong-sharpe-zero-drawdown-causality"]);
});

it.each([
  "Sharpe = mean excess return / sample deviation × sqrt(frequency). Zero drawdown does not determine Sharpe.",
  "Sharpe 不是由于零回撤，而是由超额收益和收益标准差决定。",
  "Sharpe is not due to zero drawdown.",
  "如果高 Sharpe 源于零回撤，则任意无回撤样本都应有相同 Sharpe；这个假设不成立。",
  "> Sharpe 源于零回撤\n以上是错误说法。",
  "“Sharpe 源于零回撤”是错误说法。",
])("allows correct methods, refutations and quoted counterexamples: %s", answer => {
  expect(performanceMethodClaimViolations(answer)).toEqual([]);
});

it("does not let a rejected definition hide an affirmative definition after contrast", () => {
  expect(performanceMethodClaimViolations("错误说法：Sharpe 源于零回撤，但本次高 Sharpe 源于零回撤。"))
    .toEqual(["wrong-sharpe-zero-drawdown-causality"]);
});

it("demonstrates that zero drawdown does not determine Sharpe using independent positive-return samples", () => {
  const first = [0.05, 110 / 105 - 1, 115 / 110 - 1], second = [0.01, 0.2, 0.05];
  expect(maxDrawdown(first)).toBe(0); expect(maxDrawdown(second)).toBe(0);
  expect(sharpe(first, 0, 3)).toBeCloseTo(36.33184582632725, 10);
  expect(sharpe(second, 0, 3)).toBeCloseTo(1.498615086031011, 10);
});
