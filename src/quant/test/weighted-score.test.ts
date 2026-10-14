import { expect, test } from "bun:test";
import { calculateWeightedScore, type WeightedScoreComponent } from "../weighted-score.ts";

const supplied: WeightedScoreComponent[] = [
  { name: "VIX", score: 60, weight: 0.2 }, { name: "IV rank", score: 78, weight: 0.25 },
  { name: "RSI", score: 80, weight: 0.2 }, { name: "Volume anomaly", score: 75, weight: 0.15 },
  { name: "Put/Call", score: 70, weight: 0.1 }, { name: "Consecutive down days", score: 65, weight: 0.1 },
];

test("independent supplied fear-score arithmetic ranks weighted contributions rather than component scores", () => {
  const original = structuredClone(supplied), result = calculateWeightedScore(supplied);
  // Hand-calculated: 12 + 19.5 + 16 + 11.25 + 7 + 6.5 = 72.25.
  expect(result.score).toBe(72.25);
  expect(result.roundedScore).toBe(72);
  expect(result.components.map(component => component.contribution)).toEqual([12, 19.5, 16, 11.25, 7, 6.5]);
  expect(result.largestContributors).toEqual(["IV rank"]);
  expect(supplied).toEqual(original);
  result.components[0]!.score = 0;
  expect(supplied).toEqual(original);
});

test("input permutation and different weights change drivers without hardcoding a winning component", () => {
  const shuffled = calculateWeightedScore([...supplied].reverse());
  expect(shuffled.score).toBe(72.25);
  expect(shuffled.largestContributors).toEqual(["IV rank"]);
  const changed = calculateWeightedScore([{ name: "IV rank", score: 78, weight: 0.1 }, { name: "RSI", score: 80, weight: 0.9 }]);
  expect(changed.score).toBeCloseTo(79.8, 12);
  expect(changed.largestContributors).toEqual(["RSI"]);
});

test("reports tied drivers and a zero component without silently dropping or renormalizing it", () => {
  const result = calculateWeightedScore([{ name: "a", score: 90, weight: 0.2 }, { name: "b", score: 30, weight: 0.6 },
    { name: "c", score: 0, weight: 0.2 }]);
  expect(result.score).toBe(36);
  expect(result.largestContributors).toEqual(["a", "b"]);
  expect(result.components).toHaveLength(3);
  expect(calculateWeightedScore([{ name: "a", score: 0, weight: 1 }]).score).toBe(0);
});

test("relative tie handling does not promote zero to a tiny positive maximum", () => {
  const result = calculateWeightedScore([{ name: "tiny", score: 1e-200, weight: 0.5 }, { name: "zero", score: 0, weight: 0.5 }]);
  expect(result.score).toBe(5e-201);
  expect(result.largestContributors).toEqual(["tiny"]);
  expect(() => calculateWeightedScore([{ name: "too small", score: Number.MIN_VALUE, weight: 0.25 },
    { name: "zero", score: 0, weight: 0.75 }])).toThrow("below the supported");
});

const invalidCases: WeightedScoreComponent[][] = [[], Array.from({ length: 65 }, (_, index) => ({ name: String(index), score: 50, weight: 1 / 65 })),
  [{ name: "a", score: 50, weight: 0.9 }], [{ name: "a", score: 50, weight: 20 }],
  [{ name: " a ", score: 50, weight: 0.5 }, { name: "A", score: 50, weight: 0.5 }],
  [{ name: " ", score: 50, weight: 1 }], [{ name: "a", score: NaN, weight: 1 }],
  [{ name: "a", score: Infinity, weight: 1 }], [{ name: "a", score: -1, weight: 1 }],
  [{ name: "a", score: 101, weight: 1 }], [{ name: "a", score: 50, weight: NaN }],
  [{ name: "a", score: 50, weight: -0.1 }],
];
test.each(invalidCases.map(components => ({ components })))("rejects incomplete, mislabeled, percentage-unit or invalid component inputs %#", ({ components }) => {
  expect(() => calculateWeightedScore(components)).toThrow();
});
