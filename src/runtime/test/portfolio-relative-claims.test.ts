import { expect, test } from "bun:test";
import { portfolioRelativeClaimViolations } from "../evidence/portfolio-relative-claims.ts";

const evidence = { groups: [{ name: "Core", totalReturn: 0.39, maxDrawdown: 0 },
  { name: "Stable", totalReturn: 0, maxDrawdown: 0 }] } as const;
const benchmark = { name: "SPY", totalReturn: 0.195 };

test.each([
  ["Stable收益与基准持平。", "b"], ["Stable matched the benchmark.", "b"],
  ["Core total return underperformed SPY.", "a"], ["Stable beat SPY.", "b"],
  ["Core 落后于基准。", "a"], ["**Stable** 与基准收益一致。", "b"],
  ["如果 Stable 与基准持平，需要复查；但是 Stable 跑赢基准。", "b"],
])("rejects explicit opposite direction: %s", (text, group) => {
  expect(portfolioRelativeClaimViolations(text, evidence, benchmark)).toEqual([`wrong-verified-portfolio-${group}-benchmark-direction`]);
});

test("preserves scope, actual ties, rounding distinctions and names with regular expression punctuation", () => {
  const tie = { ...benchmark, totalReturn: 0 };
  expect(portfolioRelativeClaimViolations("Stable 与基准收益持平。", evidence, tie)).toEqual([]);
  expect(portfolioRelativeClaimViolations("Stable 跑赢基准。", evidence, tie)).toEqual(["wrong-verified-portfolio-b-benchmark-direction"]);
  expect(portfolioRelativeClaimViolations("Stable matched SPY.", evidence, undefined)).toEqual([]);
  expect(portfolioRelativeClaimViolations("NotStable matched SPY.", evidence, benchmark)).toEqual([]);
  expect(portfolioRelativeClaimViolations("OtherGroup matched SPY.", evidence, benchmark)).toEqual([]);
  expect(portfolioRelativeClaimViolations("Stable matched QQQ.", evidence, benchmark)).toEqual([]);
  expect(portfolioRelativeClaimViolations("Stable matched SPY.", evidence, { name: "SPY", totalReturn: 0.0000001 }))
    .toEqual(["wrong-verified-portfolio-b-benchmark-direction"]);
  expect(portfolioRelativeClaimViolations("Core+Income matched S.PY.", { groups: [{ ...evidence.groups[0], name: "Core+Income" }, evidence.groups[1]] },
    { name: "S.PY", totalReturn: 0.195 })).toEqual(["wrong-verified-portfolio-a-benchmark-direction"]);
});

test.each(["Stable did not beat SPY.", "Stable 并非与基准持平。", "如果 Stable 跑赢基准，需要更多数据。",
  "错误示例：Stable matched SPY.", "Stable matched SPY is incorrect.", "> Stable matched SPY.",
  "```text\nStable matched SPY.\n```", "“Stable matched SPY” is wrong."])("ignores bounded counterexamples: %s", text => {
  expect(portfolioRelativeClaimViolations(text, evidence, benchmark)).toEqual([]);
});

test.each(["Core matched SPY in maximum drawdown.", "Core matched the benchmark's drawdown.",
  "Stable outperformed SPY on Sharpe.", "Core underperformed the benchmark on annual volatility."])("does not grade an explicitly different metric as total return: %s", text => {
  expect(portfolioRelativeClaimViolations(text, evidence, benchmark)).toEqual([]);
});

test("a matched drawdown does not excuse a later conflicting total-return statement", () => {
  expect(portfolioRelativeClaimViolations("Core matched SPY in drawdown, but Core matched SPY in total return.", evidence, benchmark))
    .toEqual(["wrong-verified-portfolio-a-benchmark-direction"]);
});
