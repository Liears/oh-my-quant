import { loadPanelPortfolio, saveBars, savePortfolioComparison } from "../storage/index.ts";
import { editPortfolio, findPortfolioGroup } from "./portfolio.ts";
import type { PortfolioComparisonDeps } from "./portfolio-comparison.ts";

export function portfolioEvaluationCase() {
  const portfolio = loadPanelPortfolio();
  const groupIds = ["Core", "Stable"].map(name => findPortfolioGroup(portfolio, name).id);
  const start = "2026-01-01", end = "2026-02-09";
  return { id: "portfolio" as const, symbol: "AAPL", symbols: ["AAPL", "MSFT"], start, end, market: "US" as const,
    comparisonScope: { groupIds, portfolioRevision: portfolio.revision!, benchmark: "SPY" },
    prompt: `用合成价格比较观察组合 Core 与 Stable，${start} 至 ${end}，基准 SPY；AAPL、MSFT、SPY 的报价币种和比较本位币均假设 USD，等权买入持有，缺成员即失败。先读取组合 ID 和版本，再声明任务，验收两组各自的累计收益与最大回撤，然后计算并解释依据、适用和失效条件。只需文本，不生成报告，不改组合或日期，不推断真实账户。`,
    required: [{ tool: "compare_portfolios", parameters: { group_a: groupIds[0]!, group_b: groupIds[1]!, start, end, benchmark: "SPY",
      base_currency: "USD", currencies: { AAPL: "USD", MSFT: "USD", SPY: "USD" }, weighting: "buy-and-hold", missing_members: "fail" },
      metrics: ["Portfolio A / Total return", "Portfolio B / Total return", "Portfolio A / Max drawdown", "Portfolio B / Max drawdown"] }],
    expected: [{ tool: "compare_portfolios", metric: "Portfolio A / Total return", value: 0.39 },
      { tool: "compare_portfolios", metric: "Portfolio B / Total return", value: 0 },
      { tool: "compare_portfolios", metric: "Portfolio A / Max drawdown", value: 0 }, { tool: "compare_portfolios", metric: "Portfolio B / Max drawdown", value: 0 }],
  };
}

/** Initialize only an empty, caller-isolated workspace. No real portfolio, price or FX fallback. */
export function createEvaluationPortfolioData(): PortfolioComparisonDeps {
  const existing = loadPanelPortfolio();
  if (existing.groups.length || existing.symbols.length) throw new Error("Portfolio evaluation requires an empty isolated workspace.");
  for (const [name, symbol] of [["Core", "AAPL"], ["Stable", "MSFT"]] as const) {
    editPortfolio({ type: "create", name }); editPortfolio({ type: "add", group: name, code: symbol });
  }
  return { portfolio: loadPanelPortfolio, save: savePortfolioComparison,
    async price(symbol, currency, start, end, signal) {
      signal?.throwIfAborted();
      if (!["AAPL", "MSFT", "SPY"].includes(symbol) || currency !== "USD" || start !== "2026-01-01" || end !== "2026-02-09") throw new Error("Evaluation prices require the exact synthetic symbols, USD and dates; no live fallback.");
      const bars = Array.from({ length: 40 }, (_, index) => {
        const close = 100 + index * (symbol === "AAPL" ? 1 : symbol === "SPY" ? 0.5 : 0);
        return { date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 10, amount: 1000 };
      });
      const dataset = await saveBars(symbol, "financial-datasets", bars, start, end, signal);
      if (!dataset) throw new Error("Synthetic price archive was not saved");
      return { symbol, currency, source: dataset.source, origin: "cache", observedAt: dataset.snapshotAt, dataset,
        points: bars.map(bar => ({ date: bar.date, price: bar.close })) };
    },
    async fx(baseCurrency, currencies, start, end, options) {
      options?.signal?.throwIfAborted();
      if (baseCurrency !== "USD" || currencies.some(currency => currency !== "USD") || start !== "2026-01-01" || end !== "2026-02-09") throw new Error("Evaluation only supports identity USD FX; no live fallback.");
      return { baseCurrency, points: [], source: "identity", observedAt: "2026-04-01T00:00:00.000Z" };
    },
  };
}
