import { comparePortfolios } from "../../quant/portfolio-comparison.ts";
import { saveBars, savePortfolioComparison } from "../../storage/index.ts";
import type { PortfolioComparisonInput } from "../../types/portfolio-comparison.ts";

/** Synthetic prices only; caller must isolate OHQUANT_DIR before invoking this fixture. */
export async function annualComparisonFixture(year = 2025, cutoff = `${year}-12-31`) {
  const dates = [`${year}-01-02`, `${year}-03-31`, `${year}-06-30`, cutoff];
  const input: PortfolioComparisonInput = {
    groups: [{ id: "core", name: "Core <script>bad()</script>", members: ["AAPL"] }, { id: "growth", name: "Growth", members: ["MSFT"] }],
    start: `${year}-01-01`, end: cutoff, benchmark: "SPY", baseCurrency: "USD", weighting: "buy-and-hold", missingMembers: "fail",
    portfolioRevision: "selected-historical-revision", prices: [],
    fx: { source: "identity", observedAt: "2026-01-01T00:00:00.000Z", baseCurrency: "USD", points: [] },
    request: { groups: ["core", "growth"], start: `${year}-01-01`, end: cutoff, benchmark: "SPY", baseCurrency: "USD",
      currencies: { AAPL: "USD", MSFT: "USD", SPY: "USD" }, weighting: "buy-and-hold", missingMembers: "fail", weights: [null, null] },
  };
  for (const [symbol, values] of [["AAPL", [100, 110, 90, 120]], ["MSFT", [100, 95, 100, 110]], ["SPY", [100, 105, 110, 115]]] as const) {
    const bars = dates.map((date, index) => ({ date, open: values[index]!, high: values[index]!, low: values[index]!, close: values[index]!, volume: 100, amount: 1000 }));
    const dataset = (await saveBars(symbol, "financial-datasets", bars, input.start, input.end))!;
    input.prices.push({ symbol, currency: "USD", source: dataset.source, observedAt: dataset.snapshotAt, origin: "synthetic-fixture", dataset,
      points: dates.map((date, index) => ({ date, price: values[index]! })) });
  }
  return { input, save: () => savePortfolioComparison(comparePortfolios(input)) };
}
