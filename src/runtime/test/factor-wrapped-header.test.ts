import { expect, test } from "bun:test";
import { factorLatestClaimViolations, hasAllFactorLatestClaims } from "../evidence/factor-latest-claims.ts";

const evidence = [{ factor: "momentum", period: 2, latest: -13 / 137 }, { factor: "rsi", period: 14, latest: 1300 / 27 }];
const table = "已核验数值（因子  周期  Latest  单位）\nmomentum 2 -0.0948905109489051 number\nrsi 14 48.148148148148145 number";

test("reads the original wrapped recovery header without changing any numeric claim", () => {
  expect(hasAllFactorLatestClaims(table, evidence)).toBe(true);
  expect(factorLatestClaimViolations(table, evidence)).toEqual([]);
});

test("a wrapped header still exposes a wrong selected factor value", () => {
  expect(factorLatestClaimViolations(table.replace("48.148148148148145", "100"), evidence))
    .toEqual(["wrong-verified-factor-latest"]);
});

test("missing or foreign periods cannot satisfy the wrapped table coverage", () => {
  expect(hasAllFactorLatestClaims(table.replace("rsi 14", "rsi 2"), evidence)).toBe(false);
  expect(hasAllFactorLatestClaims(table.split("\n").slice(0, -1).join("\n"), evidence)).toBe(false);
});

test("dates and prior means are not Latest values in a wrapped table", () => {
  expect(hasAllFactorLatestClaims(table.replace("48.148148148148145", "2026-02-09"), evidence)).toBe(false);
  const prior = table.replace("Latest", "Prior mean");
  expect(hasAllFactorLatestClaims(prior, evidence)).toBe(false);
  expect(factorLatestClaimViolations(prior.replace("48.148148148148145", "100"), evidence)).toEqual([]);
});
