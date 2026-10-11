import { expect, test } from "bun:test";
import { comparePortfolios } from "./portfolio-comparison.ts";
import { comparisonFixture } from "./fixtures/portfolio-comparison.ts";

test("manual two-asset holdings and rebalance ledgers, calendar CAGR and independent risk", () => {
  const input = comparisonFixture(), before = structuredClone(input), held = comparePortfolios(input);
  expect(input).toEqual(before);
  expect(held.groups[0].nav.map(point => point.value)).toEqual([1, 1.25, 1]);
  expect(held.groups[0].totalReturn).toBe(0);
  expect(held.methodVersion).toBe(2);
  expect(held.assumptions.warning).toContain("no rebalancing");
  expect(held.assumptions.warning).not.toContain("Rebalance at common valuation dates only");
  expect(held.groups[0].maxDrawdown).toBeCloseTo(-0.2, 12);
  expect(held.groups[0].excessReturn).toBeCloseTo(-0.21, 12);
  const frequency = 2 / (366 / 365.25), sd = Math.sqrt((0.225 ** 2 + (-0.225) ** 2));
  expect(held.groups[0].risk!.annualVol).toBeCloseTo(sd * Math.sqrt(frequency), 12);
  expect(held.groups[0].sharpe).toBeCloseTo(0.025 / sd * Math.sqrt(frequency), 12);
  expect(held.groups[0].risk!.var95).toBeCloseTo(-0.2, 12);
  const rebalanced = comparePortfolios({ ...input, weighting: "rebalance" });
  // 0.5*(2 + 0.5) = 1.25 each interval, so final NAV = 1.5625.
  expect(rebalanced.groups[0].nav.map(point => point.value)).toEqual([1, 1.25, 1.5625]);
  expect(rebalanced.groups[0].cagr).toBeCloseTo(1.5625 ** (365.25 / 366) - 1, 12);
  expect(rebalanced.benchmark.totalReturn).toBeCloseTo(0.21, 12);
  expect(rebalanced.assumptions.warning).toContain("restore the specified target weights");
  expect(rebalanced.assumptions.warning).not.toContain("no rebalancing");
});

test("aligns prices before returns across missing days, not unequal return intervals", () => {
  const input = comparisonFixture();
  input.prices[1]!.points.splice(1, 1);
  const result = comparePortfolios({ ...input, weighting: "rebalance" });
  expect(result.dates).toEqual([input.start, input.end]);
  expect(result.groups[0].totalReturn).toBe(0);
  expect(result.groups[0].risk).toBeNull();
  expect(result.groups[0].sharpe).toBeNull();
  expect(result.droppedDates).toEqual([{ date: "2024-07-02", missing: ["price:MSFT"] }]);
});

test("FX changes base returns while local returns stay flat; missing same-day FX is never filled", () => {
  const input = comparisonFixture();
  input.baseCurrency = input.fx.baseCurrency = "CNY";
  input.groups[0].members = ["AAPL"];
  input.prices[0]!.points.forEach(point => { point.price = 100; });
  input.prices.slice(1).forEach(price => { price.currency = "CNY"; });
  input.fx = { ...input.fx, source: "fixture-fx", points: input.prices[0]!.points.map((point, index) => ({ currency: "USD", date: point.date, rate: [7, 7.7, 8.4][index]! })) };
  const result = comparePortfolios(input);
  expect(result.groups[0].totalReturn).toBeCloseTo(0.2, 12);
  expect(result.groups[0].members[0]!.localReturn).toBe(0);
  expect(result.groups[0].members[0]!.baseReturn).toBeCloseTo(0.2, 12);
  input.fx.points.splice(1, 1);
  expect(comparePortfolios(input).droppedDates).toEqual([{ date: "2024-07-02", missing: ["fx:USD/CNY"] }]);
  input.fx.points = [];
  expect(() => comparePortfolios(input)).toThrow("Missing USD/CNY");
});

test("exclusion is explicit, renormalizes surviving weights and never excludes the benchmark", () => {
  const input = comparisonFixture();
  input.groups[0].weights = { AAPL: 0.25, MSFT: 0.75 };
  input.prices[0]!.points = [];
  expect(() => comparePortfolios(input)).toThrow("Insufficient member");
  input.missingMembers = "exclude";
  const result = comparePortfolios(input);
  expect(result.groups[0].members[0]!.initialWeight).toBe(1);
  expect(result.excludedMembers[0]).toMatchObject({ groupId: "core", symbol: "AAPL" });
  expect(result.input.groups[0].members).toEqual(["AAPL", "MSFT"]);
  input.prices[2]!.points = [];
  expect(() => comparePortfolios(input)).toThrow("Benchmark");
});

test("rejects empty groups, duplicates, malformed prices, weights and nonoverlapping calendars", () => {
  const empty = comparisonFixture(); empty.groups[0].members = [];
  expect(() => comparePortfolios(empty)).toThrow("empty");
  const duplicate = comparisonFixture(); duplicate.prices[0]!.points.push(duplicate.prices[0]!.points[0]!);
  expect(() => comparePortfolios(duplicate)).toThrow("duplicate price");
  const bad = comparisonFixture(); bad.prices[0]!.points[0]!.price = Infinity;
  expect(() => comparePortfolios(bad)).toThrow("Invalid");
  const weights = comparisonFixture(); weights.groups[0].weights = { AAPL: 0.25, MSFT: 0.25 };
  expect(() => comparePortfolios(weights)).toThrow("sum to 1");
  const disjoint = comparisonFixture(); disjoint.prices[0]!.points = [{ date: "2024-02-01", price: 1 }, { date: "2024-02-02", price: 2 }];
  expect(() => comparePortfolios(disjoint)).toThrow("common price/FX");
});

test("custom allocations and numeric limits do not manufacture zero or null risk", () => {
  const input = comparisonFixture(); input.groups[0].weights = { AAPL: 0.8, MSFT: 0.2 };
  expect(comparePortfolios(input).groups[0].nav[1]!.value).toBeCloseTo(1.7, 12);
  input.prices[0]!.points[1]!.price = 1e200;
  expect(() => comparePortfolios(input)).toThrow("numeric range");
});
