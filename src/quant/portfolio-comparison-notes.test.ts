import { expect, test } from "bun:test";
import { comparePortfolios } from "./portfolio-comparison.ts";
import { comparisonMethodNotes } from "./portfolio-comparison-notes.ts";
import { comparisonFixture } from "./fixtures/portfolio-comparison.ts";

test("risk interpretation counts actual unequal intervals across leap year without altering results", () => {
  const result = comparePortfolios(comparisonFixture()), before = structuredClone(result);
  const notes = comparisonMethodNotes(result).join("\n");
  expect(notes).toContain("3 common valuation dates form 2 adjacent return intervals");
  expect(notes).toContain("182 to 184 calendar days; unequal durations are not normalized");
  expect(notes).toContain("not risk-adjusted alpha");
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
