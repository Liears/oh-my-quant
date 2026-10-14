import { expect, test } from "bun:test";
import { knownFundAnswerViolations } from "../evidence/fund-answer-claims.ts";
import { fundComparisonClaimViolations } from "../evidence/fund-comparison-claims.ts";

for (const answer of [
  "与未对齐的基金或基准不可直接比较。",
  "与其它基金不应直接比较。",
  "TWR 与基金不能直接对比。",
  "TWR is not directly comparable with other funds.",
  "TWR cannot be directly comparable to benchmarks.",
  "‘TWR 可与其它基金或基准直接对比’是错误表述。",
]) test(`rejecting or quoting a comparison is not endorsement: ${answer}`, () => {
  expect(knownFundAnswerViolations(answer)).not.toContain("unaligned-direct-twr-comparison");
});

for (const answer of [
  "同一期间、同一币种、费用处理一致、分红处理一致是另一个方案的要求。TWR 可与其它基金直接比较。",
  "同一期间、同一币种、费用处理一致、分红处理一致时才比较；但当前 TWR 可与其它基金直接比较。",
  "TWR 在同一期间、同一币种、费用处理不一致、分红处理一致时可与基准直接比较。",
  "不能与其它基金直接对比，但当前 TWR 可与基准直接比较。",
]) test(`comparison cannot borrow another assertion's alignment: ${answer}`, () => {
  expect(knownFundAnswerViolations(answer)).toContain("unaligned-direct-twr-comparison");
});

for (const answer of [
  "TWR 只有在同一估值期间、同一币种、费用处理一致、分红处理一致时，才可与基金或基准直接比较。",
  "With a matching valuation period, same currency, consistent fee treatment and consistent distribution treatment, TWR is directly comparable with benchmarks.",
]) test(`explicit comparison alignment stays available: ${answer}`, () => {
  expect(fundComparisonClaimViolations(answer)).toEqual([]);
});

for (const answer of [
  "TWR 在同一期间、同一币种、费用处理一致、分红处理不一致时可与基准直接比较。",
  "With a matching period, same currency, not consistent fee treatment and consistent distribution treatment, TWR is directly comparable with benchmarks.",
]) test(`a negated alignment condition is not a satisfied comparison prerequisite: ${answer}`, () => {
  expect(fundComparisonClaimViolations(answer)).toEqual(["unaligned-direct-twr-comparison"]);
});
