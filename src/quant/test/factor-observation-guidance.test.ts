import { expect, test } from "bun:test";
import { factorEvidenceBoundary } from "../factor-evidence.ts";
import { momentum, reversal, volatility } from "../factor.ts";

test("momentum and reversal explain N intervals and N+1 closing observations", () => {
  for (const factor of ["momentum", "reversal"] as const) {
    expect(factorEvidenceBoundary(factor)).toContain("N return intervals require N+1 consecutive closing observations");
  }
  expect(momentum([100, 110], 2)).toEqual([null, null]);
  expect(momentum([100, 110, 120], 2)[2]).toBeCloseTo(0.2, 12);
  expect(reversal([100, 110, 120], 2)[2]).toBeCloseTo(-0.2, 12);
});

test("rolling return volatility explains the price observations needed for N returns", () => {
  expect(factorEvidenceBoundary("volatility")).toContain("N return intervals require N+1 consecutive closing observations");
  expect(volatility([100, 110], 2)).toEqual([null, null]);
  expect(volatility([100, 110, 120], 2)[2]).toBeCloseTo((0.1 - 1 / 11) / Math.sqrt(2), 12);
});
