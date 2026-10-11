import type { PortfolioComparisonInput } from "../../types/portfolio-comparison.ts";

/** A/B prices round-trip; equal initial holdings lose the rebalance premium. Entirely synthetic. */
export function comparisonFixture(): PortfolioComparisonInput {
  const dates = ["2024-01-02", "2024-07-02", "2025-01-02"];
  const series: [string, number[]][] = [["AAPL", [100, 200, 100]], ["MSFT", [100, 50, 100]], ["SPY", [100, 110, 121]]];
  return { groups: [{ id: "core", name: "Core", members: ["AAPL", "MSFT"] }, { id: "growth", name: "Growth", members: ["MSFT"] }],
    start: dates[0]!, end: dates[2]!, benchmark: "SPY", baseCurrency: "USD", weighting: "buy-and-hold", missingMembers: "fail", portfolioRevision: "fixture",
    prices: series.map(([symbol, values]) => ({
      symbol, currency: "USD", source: "synthetic-fixture", origin: "fixture", observedAt: "2025-01-03T00:00:00.000Z",
      points: values.map((price, index) => ({ date: dates[index]!, price })),
    })), fx: { baseCurrency: "USD", points: [], source: "identity", observedAt: "2025-01-03T00:00:00.000Z" } };
}
