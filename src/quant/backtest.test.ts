import { describe, expect, it } from "bun:test";
import { calmar, report, vectorizedBacktest } from "./backtest.ts";
import { evaluate } from "./benchmark.ts";

describe("backtest equity accounting", () => {
  it("marks existing shares using the absolute price change", () => {
    const result = vectorizedBacktest([1, 1, 1], [100, 100, 110], 100_000, 0, 0);
    expect(result.equity).toEqual([100_000, 100_000, 110_000]);
    expect(result.returns[2]).toBeCloseTo(0.1, 12);
  });

  it("accounts for falling prices without understating the loss", () => {
    const result = vectorizedBacktest([1, 1, 1], [100, 100, 90], 100_000, 0, 0);
    expect(result.equity).toEqual([100_000, 100_000, 90_000]);
  });

  it("lags signals and deducts entry and exit fees once", () => {
    const result = vectorizedBacktest([1, 0, 0, 0], [100, 100, 110, 120], 100_000, 0.001, 0.002);
    expect(result.position).toEqual([0, 1000, 0, 0]);
    expect(result.cost).toEqual([0, 100, 330, 0]);
    expect(result.equity).toEqual([100_000, 99_900, 109_570, 109_570]);
    expect(report(result.returns).totalReturn).toBeCloseTo(0.0957, 12);
  });
});

describe("geometric annualized returns", () => {
  it("reports volatility drag even when the arithmetic mean is zero", () => {
    const result = report([0.1, -0.1]);
    const expected = 0.99 ** 126 - 1;
    expect(result.totalReturn).toBeCloseTo(-0.01, 12);
    expect(result.cagr).toBeCloseTo(expected, 12);
    expect(calmar([0.1, -0.1])).toBeCloseTo(expected / 0.1, 12);
  });

  it("uses the same compound return for the benchmark", () => {
    const result = report([0, 0], [0.1, -0.1]);
    expect(result.excessReturn).toBeCloseTo(1 - 0.99 ** 126, 12);
    const scores = evaluate({ returns: [0.1, -0.1] }, { returns: [0, 0] });
    expect(scores.details.cagr).toBeCloseTo(0.99 ** 126 - 1, 4);
    expect(scores.details.excessReturn).toBe(scores.details.cagr);
  });

  it("annualizes exactly one trading year of returns", () => {
    const result = report(Array.from({ length: 252 }, () => 0.001));
    expect(result.cagr).toBeCloseTo(result.totalReturn, 12);
  });

  it("handles empty returns, missing observations and total loss", () => {
    expect(report([]).cagr).toBe(0);
    expect(report([NaN, 0.1, -0.1]).cagr).toBeCloseTo(0.99 ** 126 - 1, 12);
    expect(report([-1, 0]).cagr).toBe(-1);
  });
});
