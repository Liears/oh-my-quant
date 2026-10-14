import { expect, test } from "bun:test";
import { comparePortfolios } from "../portfolio-comparison.ts";
import { comparisonMethodNotes } from "../portfolio-comparison-notes.ts";
import { comparisonFixture } from "./fixtures/portfolio-comparison.ts";

test("risk interpretation counts actual unequal intervals across leap year without altering results", () => {
  const result = comparePortfolios(comparisonFixture()), before = structuredClone(result);
  const notes = comparisonMethodNotes(result).join("\n");
  expect(notes).toContain("3 common valuation dates form 2 adjacent return intervals");
  expect(notes).toContain("182 to 184 calendar days; unequal durations are not normalized");
  expect(notes).toContain("not risk-adjusted alpha");
  expect(notes).toContain("Label tables Excess return (pp), not alpha or α");
  expect(notes).toContain("zero risk-free rate");
  expect(notes).toContain("not validated forecasts or evidence of superior risk-adjusted performance");
  expect(notes).toContain("Zero observed drawdown does not mean zero risk");
  expect(result).toEqual(before);
});

test("a dropped intermediate valuation leaves one observed interval and undefined risk", () => {
  const input = comparisonFixture(); input.prices[1]!.points.splice(1, 1);
  const result = comparePortfolios(input), notes = comparisonMethodNotes(result).join("\n");
  expect(notes).toContain("2 common valuation dates form 1 adjacent return intervals");
  expect(notes).toContain("366 to 366 calendar days.");
  expect(notes).not.toContain("unequal durations");
  expect(result.groups[0].risk).toBeNull(); expect(result.groups[0].sharpe).toBeNull();
});

test("equal daily spacing does not become a statistical reliability or calendar coverage claim", () => {
  const input = comparisonFixture(), dates = ["2024-02-28", "2024-02-29", "2024-03-01"];
  input.start = dates[0]!; input.end = dates[2]!;
  input.prices.forEach(price => price.points.forEach((point, index) => { point.date = dates[index]!; }));
  const notes = comparisonMethodNotes(comparePortfolios(input)).join("\n");
  expect(notes).toContain("1 to 1 calendar days.");
  expect(notes).toContain("Calendar coverage and statistical reliability are not established");
  expect(notes).not.toContain("unequal durations");
});

test("current interpretation also describes old method archives without changing their saved warning", () => {
  const result = comparePortfolios(comparisonFixture(), 1), before = structuredClone(result);
  expect(result.assumptions.warning).toContain("Rebalance at common valuation dates only");
  expect(comparisonMethodNotes(result).join("\n")).toContain("no rebalancing");
  expect(comparisonMethodNotes(result).join("\n")).toContain("descriptive sample estimates");
  expect(result).toEqual(before);
});

test("derives benchmark direction from computed returns without changing archive results", () => {
  const result = comparePortfolios(comparisonFixture(), 1), before = JSON.stringify(result);
  expect(comparisonMethodNotes(result)).toContain("Portfolio A vs benchmark SPY: total return 0% vs 21%; excess return -21 pp; underperformed.");
  expect(JSON.stringify(result)).toBe(before);
});

test("reports matching returns only when the computed difference is zero", () => {
  const input = comparisonFixture(); input.groups[1].members = ["SPY"];
  expect(comparisonMethodNotes(comparePortfolios(input))).toContain("Portfolio B vs benchmark SPY: total return 21% vs 21%; excess return 0 pp; matched.");
});

test("shared method notes expose public series labels rather than private observation group names", () => {
  const input = comparisonFixture(); input.groups[0].name = "PRIVATE_A"; input.groups[1].name = "PRIVATE_B";
  const notes = comparisonMethodNotes(comparePortfolios(input)).join("\n");
  expect(notes).not.toContain("PRIVATE_"); expect(notes).toContain("Portfolio A vs benchmark"); expect(notes).toContain("Portfolio B vs benchmark");
});

test("single-member buy-and-hold groups retain 100% internal weight in current notes", () => {
  const input = comparisonFixture(); input.groups[0].members = ["AAPL"];
  const result = comparePortfolios(input, 1), before = structuredClone(result);
  const notes = comparisonMethodNotes(result).join("\n");
  expect(notes).toContain("Portfolio A: one included member retains 100% internal weight");
  expect(notes).toContain("Portfolio B: one included member retains 100% internal weight");
  expect(result).toEqual(before);
});

test("multi-member buy-and-hold groups qualify drift while retaining their initial quantities", () => {
  const notes = comparisonMethodNotes(comparePortfolios(comparisonFixture())).join("\n");
  expect(notes).toContain("Portfolio A: multiple included members may have weights drift");
  expect(notes).toContain("Portfolio B: one included member retains 100% internal weight");
});
