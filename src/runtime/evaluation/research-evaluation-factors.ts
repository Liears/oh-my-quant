import type { EvaluationFixture } from "./research-evaluation.ts";

/** Independent rational expectations for 100..138, then 124; constant volume 10. */
export const FACTOR_EVALUATION_EXPECTATIONS = [
  { factor: "momentum", period: 2, latest: -13 / 137 },
  { factor: "reversal", period: 2, latest: 13 / 137 },
  { factor: "volatility", period: 2, latest: (1 / 137 + 7 / 69) / Math.sqrt(2) },
  { factor: "volume_ratio", period: 20, latest: 1 },
  { factor: "rsi", period: 14, latest: 1300 / 27 },
  { factor: "sma_deviation", period: 20, latest: 21 / 515 },
] as const;

export function factorEvaluationCase(): EvaluationFixture {
  const parameters = { symbol: "AAPL", start: "2026-01-01", end: "2026-02-09" };
  return { id: "stock-factors", symbol: "AAPL", symbols: ["AAPL"], start: parameters.start, end: parameters.end, market: "US",
    prompt: "用本次归档的合成 AAPL 日线研究 2026-01-01 至 2026-02-09 的六种因子：momentum(2)、reversal(2)、volatility(2)、volume_ratio(20)、rsi(14)、sma_deviation(20)。先声明任务，分别验收六个 Latest 并调用 compute_factor 核验。回答必须逐项标明因子名、周期、Latest 数值和单位，解释计算口径、适用与失效条件；不要把因子波动率当年化风险，不将 RSI 或量比当收益率，不根据反转因子断言价格将反转。样本是在本次运行时才归档的，价格日期不是应用观测时间，请勿设置 observed_before。只需文本，不增加风险工具、交易策略或日期，不生成报告，不推断真实市场或账户。",
    required: FACTOR_EVALUATION_EXPECTATIONS.map(({ factor, period }) => ({ tool: "compute_factor",
      parameters: { ...parameters, factor, period }, metrics: ["Latest"] })),
    expected: FACTOR_EVALUATION_EXPECTATIONS.map(({ factor, period, latest }) => ({ tool: "compute_factor", metric: "Latest",
      parameters: { ...parameters, factor, period }, value: latest })),
  };
}
