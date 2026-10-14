import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mean, sampleDeviation, distributionShape } from "../statistics.ts";

const reference = JSON.parse(readFileSync(new URL("./fixtures/numeric-decimal-goldens.json", import.meta.url), "utf8")) as {
  precision: number; cases: Array<{ case: number; values: number[]; mean: number; sampleDeviation: number | null;
    shape: { skewness: number; kurtosis: number } }>;
};
function matches(actual: number, expected: number): void {
  if (expected === 0) expect(actual).toBeCloseTo(0, 12);
  else expect(actual / expected).toBeCloseTo(1, 12);
}
for (const fixture of reference.cases) test(`statistics match independent ${reference.precision}-digit Decimal reference ${fixture.case}`, () => {
  matches(mean(fixture.values), fixture.mean);
  if (fixture.sampleDeviation === null) expect(() => sampleDeviation(fixture.values)).toThrow();
  else matches(sampleDeviation(fixture.values), fixture.sampleDeviation);
  const shape = distributionShape(fixture.values);
  matches(shape.skewness, fixture.shape.skewness); matches(shape.kurtosis, fixture.shape.kurtosis);
});
