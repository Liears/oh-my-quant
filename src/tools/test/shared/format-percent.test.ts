import { expect, test } from "bun:test";
import { formatPercent } from "../../shared/format-percent.ts";

test("ordinary percentage units, signs and requested precision stay unchanged", () => {
  expect(formatPercent(0.125)).toBe("12.50%");
  expect(formatPercent(-0.125, 1)).toBe("-12.5%");
  expect(formatPercent(0)).toBe("0.00%");
});
test("both signs of a finite value can be displayed beyond the Number percentage range", () => {
  expect(formatPercent(Number.MAX_VALUE)).toBe("1.80e+310%");
  expect(formatPercent(-Number.MAX_VALUE)).toBe("-1.80e+310%");
});
test("nonfinite source values are rejected instead of displayed as valid evidence", () => {
  for (const value of [NaN, Infinity, -Infinity]) expect(() => formatPercent(value)).toThrow();
});
