import { expect, test } from "bun:test";
import { portfolioWeightClaimViolations, suppliedPortfolioWeights } from "../evidence/portfolio-weight-claims.ts";
import { knownSkillAnswerViolations } from "../evaluation/skill-evaluation-answer.ts";

const request = "supplied proxy portfolio snapshot: TLT 35%, XLE 25%, SPY 40%; weights sum to 100%.";
test.each(["约75% 与股票风险挂钩（SPY+XLE）", "SPY+XLE 合计75%", "SPY + XLE = 75%"])("rejects a named wrong sum: %s", answer => {
  expect(portfolioWeightClaimViolations(answer, request)).toEqual(["wrong-supplied-weight-sum"]);
  expect(knownSkillAnswerViolations("skill-macro-portfolio-impact", answer)).toContain("wrong-supplied-weight-sum");
});
test.each(["65% 与股票风险挂钩（SPY+XLE）", "SPY+XLE = 65%", "SPY+QQQ = 75%", "SPY+SPY = 75%", "不是75% 与股票风险挂钩（SPY+XLE）", "“SPY+XLE = 75%”是错误表述", "\n> SPY+XLE = 75%"])("abstains on correct, ambiguous or qualified claims: %s", answer => {
  expect(portfolioWeightClaimViolations(answer, request)).toEqual([]);
});
test("binds different supplied values and abstains on conflicting or absent inputs", () => {
  expect(portfolioWeightClaimViolations("SPY+XLE = 65%", "portfolio: SPY 30%, XLE 20%")).toEqual(["wrong-supplied-weight-sum"]);
  expect(portfolioWeightClaimViolations("SPY+XLE = 75%", request + " SPY 50%")).toEqual([]);
  expect(suppliedPortfolioWeights("unrelated SPY 40% XLE 25%").size).toBe(0);
  expect(portfolioWeightClaimViolations("SPY+XLE = 75%", "继续")).toEqual([]);
});
