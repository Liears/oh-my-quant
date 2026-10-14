import { expect, test } from "bun:test";
import { compareTotalReturns } from "../relative-return.ts";

test.each([
  [0.39, 0.195, 0.195, "outperformed"], [0, 0.195, -0.195, "underperformed"],
  [-0.1, -0.2, 0.1, "outperformed"], [-0.2, -0.1, -0.1, "underperformed"],
  [0, 0, 0, "matched"], [0.3, 0.1 + 0.2, 0, "matched"],
  [0.1950001, 0.195, 0.0000001, "outperformed"],
] as const)("compares unrounded returns %s vs %s", (portfolio, benchmark, difference, direction) => {
  const result = compareTotalReturns(portfolio, benchmark);
  expect(result.direction).toBe(direction); expect(result.excessReturn).toBeCloseTo(difference, 12);
});

test.each([[NaN, 0], [0, Infinity], [Number.MAX_VALUE, -Number.MAX_VALUE]])("rejects unsupported numeric input %s vs %s", (a, b) => {
  expect(() => compareTotalReturns(a, b)).toThrow();
});
