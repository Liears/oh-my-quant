import { expect, test } from "bun:test";
import { metrics } from "../risk.ts";
import { mean, sampleDeviation, downsideDeviation, maxDrawdown, maxDdDuration, report, sharpe, sortino, profitLossRatio } from "../performance.ts";
import { standardize, volatility, volumeRatio, smaDeviation } from "../factor.ts";

test("a finite mean does not overflow while summing identical large observations", () => {
  expect(mean([1e308, 1e308])).toBe(1e308);
  expect(Object.values(metrics([1e308, 1e308])).every(Number.isFinite)).toBe(true);
});
test("large sample deviation remains representable when its variance is not", () => {
  expect(sampleDeviation([1e200, 0, 0]) / (1e200 / Math.sqrt(3))).toBeCloseTo(1, 12);
});
test("small sample deviation is retained even when squaring it underflows", () => {
  expect(sampleDeviation([1e-200, -1e-200]) / (Math.sqrt(2) * 1e-200)).toBeCloseTo(1, 12);
});
test("risk annualization preserves tiny volatility and zero-target downside values", () => {
  const value = metrics([1e-200, -1e-200]);
  expect(value.annualVol / (Math.sqrt(504) * 1e-200)).toBeCloseTo(1, 12);
  expect(value.downsideVol / (Math.sqrt(126) * 1e-200)).toBeCloseTo(1, 12);
});
test("population shape coefficients use normalized deviations for large inputs", () => {
  const value = metrics([1e200, 0, 0]);
  expect(value.skewness).toBeCloseTo(1 / Math.sqrt(2), 12);
  expect(value.kurtosis).toBeCloseTo(-1.5, 12);
  expect(Object.values(value).every(Number.isFinite)).toBe(true);
});
test("tiny symmetric observations have zero skew and minus-two excess kurtosis", () => {
  const value = metrics([1e-200, -1e-200]);
  expect(value.skewness).toBe(0); expect(value.kurtosis).toBeCloseTo(-2, 12);
});
test("rolling factor volatility uses the same stable sample deviation", () => {
  const values = volatility([1, 1e200, 1e200], 2);
  expect(values.slice(0, 2)).toEqual([null, null]);
  expect(values[2]! / (1e200 / Math.sqrt(2))).toBeCloseTo(1, 12);
});
test("volume ratios do not divide by an overflowing sum", () => {
  expect(volumeRatio([1e308, 1e308], 2)).toEqual([null, 1]);
});
test("constant large prices yield zero SMA deviation rather than NaN", () => {
  expect(smaDeviation(Array(5).fill(1e308), 5, 5)).toEqual([null, null, null, null, 0]);
});
test("large factor scores remain scaled and preserve missing observations", () => {
  const values = standardize([null, 1e200, 0, 0]);
  expect(values[0]).toBeNull(); expect(values[1]).toBeCloseTo(2 / Math.sqrt(3), 12);
  expect(values[2]).toBeCloseTo(-1 / Math.sqrt(3), 12); expect(values[3]).toBeCloseTo(-1 / Math.sqrt(3), 12);
});
test("tiny nonconstant factor scores do not become flat zero values", () => {
  const values = standardize([null, 1e-200, -1e-200]);
  expect(values[0]).toBeNull(); expect(values[1]).toBeCloseTo(1 / Math.sqrt(2), 12);
  expect(values[2]).toBeCloseTo(-1 / Math.sqrt(2), 12);
});
test("constant factor normalization does not fabricate warmup observations", () => {
  expect(standardize([null, 5, 5])).toEqual([null, 0, 0]);
});
test("drawdown ratios and recovery duration survive a path whose equity product overflows", () => {
  const values = [1e200, 1e200, -0.5, 1];
  expect(maxDrawdown(values)).toBeCloseTo(-0.5, 12); expect(maxDdDuration(values)).toBe(1);
});
test("small drawdown ratios do not disappear when one plus return rounds to one", () => {
  expect(maxDrawdown([1e-200, -1e-200]) / -1e-200).toBeCloseTo(1, 12);
});
test("a report rejects genuinely unrepresentable total returns", () => {
  expect(() => report([1e200, 1e200], undefined, { elapsedYears: 1000 })).toThrow();
});
test("risk rejects genuinely unrepresentable annualized outputs", () => {
  expect(() => metrics([Number.MAX_VALUE, 0])).toThrow();
});
test("Sharpe rejects a genuinely unrepresentable ratio rather than returning Infinity", () => {
  expect(() => sharpe([-1e-308, 1e-308], 1e308)).toThrow();
});
test("Sortino retains a finite ratio over tiny downside observations", () => {
  expect(sortino([0, -1e-308], 0)).toBeCloseTo(-Math.sqrt(126), 12);
});
test("profit-loss ratios reject unsupported magnitude instead of producing nonfinite output", () => {
  expect(() => profitLossRatio([1e200, -1e-200])).toThrow();
});
test("downside RMS keeps all observations in the denominator at tiny scales", () => {
  expect(downsideDeviation([-1e-200, 0, 1e-200]) / (1e-200 / Math.sqrt(3))).toBeCloseTo(1, 12);
});
test("sample deviation preserves empty and singleton conventions while rejecting nonfinite data", () => {
  expect(sampleDeviation([])).toBe(0); expect(sampleDeviation([4])).toBe(0);
  expect(() => sampleDeviation([NaN])).toThrow(); expect(() => mean([Infinity])).toThrow();
});

test("large common offsets do not erase the sample spread through rounded means", () => {
  const gap = 2 ** -13;
  expect(sampleDeviation([1e12, 1e12 + gap]) / (gap / Math.sqrt(2))).toBeCloseTo(1, 12);
});

test("dimensionless scores remain finite even when the dimensional deviation cannot be represented", () => {
  const values = standardize([-Number.MAX_VALUE, Number.MAX_VALUE]);
  expect(values[0]).toBeCloseTo(-1 / Math.sqrt(2), 12);
  expect(values[1]).toBeCloseTo(1 / Math.sqrt(2), 12);
});

test("a cancelled large mean retains small terms instead of losing them during normalization", () => {
  expect(mean([Number.MAX_VALUE, -Number.MAX_VALUE, 1e-200]) / (1e-200 / 3)).toBeCloseTo(1, 12);
  expect(mean([1e308, 1e-10, -1e308]) / (1e-10 / 3)).toBeCloseTo(1, 12);
  expect(mean([Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE])).toBe(Number.MIN_VALUE);
});
