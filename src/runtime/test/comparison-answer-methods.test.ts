import { expect, it } from "bun:test";
import { comparisonExcessClaimViolations } from "../evidence/comparison-answer-methods.ts";

it.each([
  "组别        收益     α      DD       波动\nEQ core    20.00%  +5.00%  -18.18%  44.82%\nEQ growth  10.00%  -5.00%  -5.00%   13.32%",
  "| 组合 | 总回报 | α |\n| Core | 20% | +5pp |\n| Growth | 10% | -5pp |\n超额是百分点差，不是风险调整 alpha。",
  "| Series | Alpha |\n| Core | +5.0 |",
  "EQ Core·AAPL TR 20% DD -18.18% α +5pp",
  "超额收益是风险调整 alpha。",
])("rejects alpha attribution within the WhyJ comparison contract: %s", answer => {
  expect(comparisonExcessClaimViolations(answer)).toEqual(["excess-return-labelled-alpha"]);
});

it.each([
  "| 组合 | 总回报 | 超额收益（百分点） |\n| Core | 20% | +5pp |\n超额收益不是风险调整 alpha。",
  "| Series | Alpha |\n| Core | N/A |\nThis tool does not estimate alpha.",
  "超额收益为 +5 个百分点，不是 alpha。",
  "错误说法：超额收益是风险调整 alpha。",
  "> | Series | Alpha |\n> | Core | +5pp |\n这是错误例子。",
  "```text\n| Series | Alpha |\n| Core | +5pp |\n```\n请将以上错误表头改为超额收益。",
  "alpha 是需要独立估计的指标；当前只计算超额收益 +5pp。",
])("allows labelled differences, unavailable alpha and refutations: %s", answer => {
  expect(comparisonExcessClaimViolations(answer)).toEqual([]);
});
