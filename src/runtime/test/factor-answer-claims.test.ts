import { expect, it } from "bun:test";
import { factorLatestClaimViolations, hasExplicitFactorLatestClaim, knownFactorAnswerViolations } from "../evidence/factor-answer-claims.ts";

it.each([
  "momentum 分位不预测后续收益，均值回归已经出现。",
  "momentum 分位不预测后续收益，因此均值回归已成立。",
  "momentum 分位不预测后续收益，同时存在均值回归。",
  "不预测后续收益、均值回归已经出现。",
  "不预测后续收益，均值回归或交易优势已经出现。",
  "均值回归，尚未确认后续收益。",
  "Mean reversion is present, future returns were not tested.",
])("does not extend a limitation to an independent assertion: %s", text => {
  expect(knownFactorAnswerViolations(text)).toEqual(["unsupported-mean-reversion-claim"]);
});

it("allows explicit non-prediction without hiding a subsequent mean-reversion assertion", () => {
  expect(knownFactorAnswerViolations("momentum 分位不预测后续收益或均值回归。")).toEqual([]);
  expect(knownFactorAnswerViolations("momentum 分位不预测后续收益或均值回归，但能确认均值回归。"))
    .toEqual(["unsupported-mean-reversion-claim"]);
  expect(knownFactorAnswerViolations("momentum 分位不预测后续收益，均值回归已经确认。"))
    .toEqual(["unsupported-mean-reversion-claim"]);
  expect(knownFactorAnswerViolations("momentum 分位不预测后续收益或均值回归，同时本指标能确认均值回归。"))
    .toEqual(["unsupported-mean-reversion-claim"]);
  for (const warning of ["不能同时确认均值回归。", "历史分位无法同时检验均值回归和收益预测。",
    "不检验未来收益, mean reversion 或预测优势。", "不预测后续收益，均值回归或交易优势。",
    "均值回归，尚未确认。", "均值回归，需进一步检验。", "均值回归，仍待验证。",
    "不预测后续收益，均值回归，交易优势。", "Mean reversion, requires testing.", "Mean reversion, not established."]) {
    expect(knownFactorAnswerViolations(warning)).toEqual([]);
  }
});

it("flags an asserted reversal from a low momentum rank while allowing explicit uncertainty", () => {
  expect(knownFactorAnswerViolations("momentum(2) 最新值 0.0146 低于均值，分位 0%：属短周期均值回归型特征。"))
    .toEqual(["unsupported-mean-reversion-claim"]);
  expect(knownFactorAnswerViolations("The low historical percentile is a mean-reversion signal.")).toEqual(["unsupported-mean-reversion-claim"]);
  expect(knownFactorAnswerViolations("历史分位 0% 只说明本窗口排序，未检验均值回归。")).toEqual([]);
  expect(knownFactorAnswerViolations("Prior percentile 为 0% 是分布内排名，不构成均值回归或未来收益的证据。")).toEqual([]);
  expect(knownFactorAnswerViolations("不检验后续收益、均值回归或预测优势。")).toEqual([]);
  expect(knownFactorAnswerViolations("需要另行检验均值回归，当前结果不足以证明未来收益。")).toEqual([]);
  expect(knownFactorAnswerViolations("Mean reversion was not tested by the historical factor summary.")).toEqual([]);
  expect(knownFactorAnswerViolations("0% 分位不构成均值回归证据，但可以确认短期均值回归。")).toEqual(["unsupported-mean-reversion-claim"]);
  expect(knownFactorAnswerViolations("Mean reversion was not tested, but this proves mean reversion.")).toEqual(["unsupported-mean-reversion-claim"]);
  expect(knownFactorAnswerViolations("最新动量低于前期均值，但未来收益未知。")).toEqual([]);
});

it("keeps the retained untested conclusion distinct from a later affirmative claim", () => {
  expect(knownFactorAnswerViolations("momentum 的 Latest/Prior 值不测试后续收益或均值回归。")).toEqual([]);
  expect(knownFactorAnswerViolations("不测试均值回归，但本结果证明均值回归。"))
    .toEqual(["unsupported-mean-reversion-claim"]);
});

it("keeps the retained recovery's no-prediction clause distinct from a mean-reversion claim", () => {
  expect(knownFactorAnswerViolations("最新值/历史均值/分位只描述窗口内分布，不预测后续收益或均值回归。"))
    .toEqual([]);
  expect(knownFactorAnswerViolations("不预测后续收益或均值回归，但本结果证明均值回归。"))
    .toEqual(["unsupported-mean-reversion-claim"]);
});

it("checks an explicit Latest value in its stated decimal or percent precision", () => {
  const evidence = { factor: "momentum", latest: 139 / 137 - 1 };
  expect(factorLatestClaimViolations("Latest 0.0146; Prior percentile 0%", evidence)).toEqual([]);
  expect(factorLatestClaimViolations("Latest: 0.014598540145985384", evidence)).toEqual([]);
  expect(factorLatestClaimViolations("最新动量值 1.46%", evidence)).toEqual([]);
  expect(factorLatestClaimViolations("最新因子值 0.0146", evidence)).toEqual([]);
  expect(factorLatestClaimViolations("Latest 0.0946", evidence)).toEqual(["wrong-verified-factor-latest"]);
  expect(factorLatestClaimViolations("最新值 9.46%", evidence)).toEqual(["wrong-verified-factor-latest"]);
  expect(hasExplicitFactorLatestClaim("Prior percentile 0% and latest price date 2026-02-09")).toBe(false);
  expect(hasExplicitFactorLatestClaim("Latest 2026-02-09")).toBe(false);
  expect(factorLatestClaimViolations("| Latest | 2026-02-09 |", evidence)).toEqual([]);
  expect(factorLatestClaimViolations("RSI Latest 60%", { factor: "rsi", latest: 60 })).toEqual([]);
});
