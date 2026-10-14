import { expect, test } from "bun:test";
import { weightedScoreAnswerViolations } from "../evidence/weighted-score-answer.ts";
import { checkSkillEvaluationAnswer, knownSkillAnswerViolations } from "../evaluation/skill-evaluation-answer.ts";
import { skillEvaluationCase } from "../evaluation/skill-evaluation-fixtures.ts";

const components = skillEvaluationCase("skill-risk-fear-score").weightedScore!.components;

test.each([
  "RSI 29（score 80，贡献最大 16.00）、IV rank 78（19.50）",
  "RSI contributes the largest weighted contribution of 16.00.",
  "主要驱动RSI：贡献最大16.00。",
])("rejects the retained misranked driver: %s", answer => {
  expect(weightedScoreAnswerViolations(answer, components)).toEqual(["wrong-weighted-score-largest-contributor"]);
  expect(knownSkillAnswerViolations("skill-risk-fear-score", answer)).toContain("wrong-weighted-score-largest-contributor");
});

test.each([
  "IV rank 78 贡献最大19.50；RSI 29贡献16.00，score80最高。",
  "IVrank has the largest weighted contribution: 19.50, RSI contributes 16.00.",
  "不是 RSI 贡献最大，而是 IV rank 贡献最大。",
  "RSI 贡献不是最大，IV rank 的19.50更高。",
  "RSI has the highest unweighted score of 80; IV rank contributes most.",
  '错误例子：“RSI 贡献最大16.00”。实际IV rank为19.50。',
  "> RSI 贡献最大16.00\nIV rank 贡献最大19.50。",
])("keeps the correct driver and negated or quoted counterexamples: %s", answer => {
  expect(weightedScoreAnswerViolations(answer, components)).toEqual([]);
});

test("binds the winning driver to different supplied weights and accepts ties", () => {
  const changed = [{ name: "RSI", score: 80, weight: 0.9 }, { name: "IV rank", score: 78, weight: 0.1 }];
  expect(weightedScoreAnswerViolations("RSI贡献最大。", changed)).toEqual([]);
  expect(weightedScoreAnswerViolations("IV rank贡献最大。", changed)).toEqual(["wrong-weighted-score-largest-contributor"]);
  expect(weightedScoreAnswerViolations("a贡献最大；b贡献最大。", [
    { name: "a", score: 40, weight: 0.5 }, { name: "b", score: 40, weight: 0.5 },
  ])).toEqual([]);
  expect(weightedScoreAnswerViolations("RSI贡献最大。", undefined)).toEqual([]);
});

test("checks labelled unrounded totals while keeping rounded composite wording distinct", () => {
  expect(weightedScoreAnswerViolations("加权合计72.25，Composite 72/100 after rounding。", components)).toEqual([]);
  expect(weightedScoreAnswerViolations("Weighted total: 72.26", components)).toEqual(["wrong-weighted-score-total"]);
  expect(weightedScoreAnswerViolations("未舍入总分为71.25。", components)).toEqual(["wrong-weighted-score-total"]);
  expect(weightedScoreAnswerViolations("Composite: 72/100", components)).toEqual([]);
});

test("preserves consecutive down days rather than accepting an arbitrary four-day count", () => {
  const prompt = skillEvaluationCase("skill-risk-fear-score").prompt;
  expect(checkSkillEvaluationAnswer("skill-risk-fear-score", prompt).evidence).toBe(true);
  // Remove both the original prose and the redundant structured input name.
  const altered = prompt.replaceAll("4 consecutive down days", "4 down days").replaceAll("Consecutive down days", "Down days");
  expect(checkSkillEvaluationAnswer("skill-risk-fear-score", altered).evidence).toBe(false);
});
