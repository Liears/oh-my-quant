import { expect, it } from "bun:test";
import { factorLatestClaimViolations, hasExplicitFactorLatestClaim, knownFactorAnswerViolations } from "./factor-answer-claims.ts";

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
