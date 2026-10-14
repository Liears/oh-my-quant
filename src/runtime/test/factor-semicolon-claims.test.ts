import { expect, test } from "bun:test";
import { factorLatestClaimViolations } from "../evidence/factor-latest-claims.ts";

const facts = [{ factor: "sma_deviation", period: 20, latest: 21 / 515 }, { factor: "rsi", period: 14, latest: 1300 / 27 }];
const explanation = "- sma_deviation(20)：(SMA(5) - SMA(20)) / SMA(20)，是两条均线的相对偏离；需两个窗口数据同时可得。Latest 0.0408 表示短期均线高于长期均线约 4.08%。";

test("retains the sole named factor before a semicolon in the actual explanatory line", () => {
  expect(factorLatestClaimViolations(explanation, facts)).toEqual([]);
  expect(factorLatestClaimViolations(explanation.replace("Latest 0.0408", "Latest 0.9"), facts)).toEqual(["wrong-verified-factor-latest"]);
});

test("an unlabeled value after multiple distinct factors remains ambiguous", () => {
  expect(factorLatestClaimViolations("sma_deviation(20) 与 rsi(14) 已计算；Latest 0.0408", facts)).toEqual(["ambiguous-verified-factor-latest"]);
});

test("separate explicit Latest labels on one line keep each factor's own scope", () => {
  expect(factorLatestClaimViolations("sma_deviation(20)；Latest 0.0408；rsi(14)；Latest 48.1481", facts)).toEqual([]);
  expect(factorLatestClaimViolations("sma_deviation(20)；Latest 0.0408；rsi(14)；Latest 100", facts)).toEqual(["wrong-verified-factor-latest"]);
});
