import { expect, test } from "bun:test";
import { knownSkillAnswerViolations } from "../evaluation/skill-evaluation-answer.ts";

test.each([
  ["重新验证保证金触发条件，提供的 68% 对比 <70% 阈值。", ["gross-margin-translated-as-collateral"]],
  ["NVDA gross margin 是保证金，阈值 70%。", ["gross-margin-translated-as-collateral"]],
  ["触发论文 1 NVDA，观测日期 2026-09-17。", ["research-thesis-translated-as-academic-paper"]],
  ["论文漂移 — 未提供漂移证据。", ["research-thesis-translated-as-academic-paper"]],
  ["NVDA 投资论点：毛利率 68%，给定阈值为 70%。", []],
  ["Gross margin is 68%; the investment thesis threshold is 70%.", []],
  ["毛利率不是保证金，thesis 是投资逻辑。", []],
  ["旧回答的“保证金触发条件”和“触发论文”是错误翻译。", []],
  ["如果将毛利率写成保证金触发条件，需要更正。", []],
  ["触发论文是错误翻译，应保留投资论点的原始含义。", []],
] as const)("health workflow checks explicit financial terminology: %s", (answer, expected) => {
  expect(knownSkillAnswerViolations("skill-risk-health", answer)).toEqual([...expected]);
});
