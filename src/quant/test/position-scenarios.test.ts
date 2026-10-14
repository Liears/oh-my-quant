import { expect, it } from "bun:test";
import { calculatePositionScenarios } from "../position-scenarios.ts";

it("keeps price change, position value and P/L relative to cost distinct", () => {
  const rows = calculatePositionScenarios({ shares: 200, costPerShare: 50, observedClose: 42 }, [-0.1, -0.2, 0, 0.1]);
  const expected = [[37.8, 7560, -2440, -0.244], [33.6, 6720, -3280, -0.328], [42, 8400, -1600, -0.16], [46.2, 9240, -760, -0.076]];
  rows.forEach((row, index) => {
    [row.price, row.value, row.profitLoss, row.returnOnCost].forEach((value, column) => expect(value).toBeCloseTo(expected[index]![column]!, 10));
  });
});

it("supports explicitly supplied fractional shares, zero scenario price and profitable positions", () => {
  const rows = calculatePositionScenarios({ shares: 2.5, costPerShare: 8, observedClose: 10 }, [-1, 0, 0.2]);
  expect(rows).toEqual([
    { change: -1, price: 0, value: 0, profitLoss: -20, returnOnCost: -1 },
    { change: 0, price: 10, value: 25, profitLoss: 5, returnOnCost: 0.25 },
    { change: 0.2, price: 12, value: 30, profitLoss: 10, returnOnCost: 0.5 },
  ]);
});

it.each([0, -1, NaN, Infinity])("rejects invalid position inputs: %s", invalid => {
  for (const field of ["shares", "costPerShare", "observedClose"] as const) {
    expect(() => calculatePositionScenarios({ shares: 200, costPerShare: 50, observedClose: 42, [field]: invalid }, [0])).toThrow();
  }
});

it.each([-1.001, NaN, Infinity])("rejects invalid scenario changes: %s", change => {
  expect(() => calculatePositionScenarios({ shares: 200, costPerShare: 50, observedClose: 42 }, [change])).toThrow();
});

it("bounds scenario count and rejects arithmetic overflow", () => {
  expect(() => calculatePositionScenarios({ shares: 200, costPerShare: 50, observedClose: 42 }, Array(33).fill(0))).toThrow();
  expect(() => calculatePositionScenarios({ shares: Number.MAX_VALUE, costPerShare: 50, observedClose: 42 }, [0])).toThrow();
});
