import { expect, it } from "bun:test";
import { knownFundAnswerViolations } from "./fund-answer-claims.ts";

it("rejects the four definite contradictions found in the retained real fund answer", () => {
  const answer = [
    "本金收益率也与基金本身表现无关。",
    "TWR 可与其它基金或基准直接对比。",
    "标的：270042.OF（A 股开放式基金）。",
    "短窗口回撤无统计意义。",
  ].join("\n");
  expect(knownFundAnswerViolations(answer)).toEqual([
    "principal/fund-independence-claim", "unaligned-direct-twr-comparison",
    "unsupported-a-share-fund-classification", "unsupported-zero-statistical-meaning",
  ]);
});

it("allows bounded comparisons and explicit warnings about what the synthetic NAV does not prove", () => {
  const answer = "本金收益依赖基金净值、费用和投入时点；TWR 只有在同一估值期间、同一币种、费用处理一致、分红处理一致时，才可与基金或基准直接比较。A 市场是取数路由，不证明底层 A 股配置。仅一段 NAV 观察不能评估管理能力或区间内回撤。";
  expect(knownFundAnswerViolations(answer)).toEqual([]);
});

it("does not treat an explicit warning about direct fund comparisons as endorsement", () => {
  expect(knownFundAnswerViolations("与同期基金涨幅直接对比会误导；需匹配区间、币种和费用口径。")).toEqual([]);
  expect(knownFundAnswerViolations("不能与未对齐的基准直接比较。TWR 可与其它基金直接对比。")).toEqual(["unaligned-direct-twr-comparison"]);
});

it("detects the equivalent English direct comparison and fund-independence claims", () => {
  expect(knownFundAnswerViolations("Principal return is independent of fund performance. TWR is directly comparable with benchmarks.")).toEqual([
    "principal/fund-independence-claim", "unaligned-direct-twr-comparison",
  ]);
});

it("rejects the second real answer's purchase NAV and day-count contradictions", () => {
  expect(knownFundAnswerViolations("本例两次申购成本均为 0.6000；XIRR 因 29 天窗口年化放大。")).toEqual([
    "blended-cost-as-each-purchase-nav", "wrong-fixed-window-day-count",
  ]);
  expect(knownFundAnswerViolations("两次申购 NAV 分别为 0.5000/0.7500，平均成本 0.6000；首笔持有 28 天。")).toEqual([]);
});

it("rejects a principal formula whose stated final value cannot produce the reported 25%", () => {
  expect(knownFundAnswerViolations("Principal return 25.00% （末期模拟市值 200 − 投入 200 本金）/ 200")).toEqual([
    "wrong-fixed-principal-formula",
  ]);
  expect(knownFundAnswerViolations("Principal return 25.00% （期末模拟市值 250 − 投入 200 本金）/ 200")).toEqual([]);
});

it("compares clearly labelled percentages with verified fund metrics, including recovery tables", () => {
  const evidence = { principalReturn: 0.25, timeWeightedReturn: 0.5, maximumDrawdownTwr: 0 };
  expect(knownFundAnswerViolations("Principal return 20.00%\nTime-weighted return 50.00%\nMaximum drawdown (TWR) 0.00%", evidence))
    .toEqual(["wrong-verified-principal-return"]);
  expect(knownFundAnswerViolations("本金收益率 25％；TWR 40%；剔除外部投入最大回撤 5％", evidence))
    .toEqual(["wrong-verified-time-weighted-return", "wrong-verified-twr-drawdown"]);
  expect(knownFundAnswerViolations("Principal return +25.000% | Time-weighted return +50.000% | MaxDD(TWR) 0.000%", evidence))
    .toEqual([]);
  expect(knownFundAnswerViolations("XIRR 19645.828% 是 28 天现金流的年化解；Maximum drawdown (TWR) 0.00%。", evidence))
    .toEqual([]);
  expect(knownFundAnswerViolations("本金收益率与 XIRR 19645.828% 不同，不能把短窗年化当作本金收益。", evidence))
    .toEqual([]);
});
