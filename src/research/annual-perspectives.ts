/** Versioned source paraphrases. These are historical views, not forecasts or model output. */
export const ANNUAL_PERSPECTIVES_V1 = [
  {
    id: "buffett-2013-letter", author: "Warren E. Buffett", title: "Berkshire Hathaway 2013 Shareholder Letter",
    published: "2014-02-28", url: "https://www.berkshirehathaway.com/letters/2013ltr.pdf", locator: "PDF page 19 / printed page 20",
    checkedAt: "2026-09-14",
    summary: "在讨论非专业投资者和遗产安排时，强调控制费用和低成本指数化。",
    application: "本报告比较基准，但未计交易费用；零费超额收益不能当作可实现的净超额收益。信中的遗嘱配置不作为用户配置建议。",
  },
  {
    id: "marks-2001-prepare", author: "Howard Marks", title: "You Can’t Predict. You Can Prepare.",
    published: "2001-11-20", url: "https://www.oaktreecapital.com/docs/default-source/memos/2001-11-20-you-cant-predict-you-can-prepare.pdf", locator: "PDF page 1",
    checkedAt: "2026-09-14",
    summary: "区分识别当前周期环境与预测下一次转折的时间和幅度，强调为不确定性作准备。",
    application: "用已观察回撤检查研究假设的承受力；历史曲线不能证明下一年的转折或收益。",
  },
] as const;
