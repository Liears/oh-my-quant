import { describe, expect, it } from "bun:test";
import { vectorizedBacktest, report, sortino, maxDdDuration } from "./backtest.ts";
import { evaluate } from "./benchmark.ts";
import { calendarYears } from "./performance.ts";
import { metrics } from "./risk.ts";
import { collectResults, dashboardSummary } from "./dashboard.ts";

describe("self-financing backtest ledger", () => {
  it("matches the independent 1000-share ledger and lags the signal", () => {
    const r = vectorizedBacktest([1, 1, 1], [100, 100, 110], 100_000, 0, 0);
    expect(r.equity).toEqual([100_000, 100_000, 110_000]);
    expect(r.position).toEqual([0, 1000, 1000]);
    expect(r.returns[2]).toBeCloseTo(0.1, 12);
    expect(r.cash).toEqual([100_000, 0, 0]);
  });

  it("reinvests current equity instead of resetting exposure to initial cash", () => {
    const r = vectorizedBacktest([1, 1, 0, 1, 1], [100, 100, 120, 120, 100], 1000, 0, 0);
    expect(r.position).toEqual([0, 10, 10, 0, 12]);
    expect(r.cash).toEqual([1000, 0, 0, 1200, 0]);
    expect(r.equity).toEqual([1000, 1000, 1200, 1200, 1200]);
  });

  it("funds entry fees from cash and charges sell duty only on sale", () => {
    // 1000 / (100 * 1.01) shares; liquidation receives price * (1 - .01 - .02).
    const r = vectorizedBacktest([1, 0, 0], [100, 100, 110], 1000, 0.01, 0.02);
    const shares = 1000 / 101;
    expect(r.position[1]).toBeCloseTo(shares, 12);
    expect(r.cash[1]).toBeCloseTo(0, 10);
    expect(r.cost[1]).toBeCloseTo(shares, 10);
    expect(r.equity[2]).toBeCloseTo(shares * 110 * 0.97, 10);
    expect(r.cost[2]).toBeCloseTo(shares * 110 * 0.03, 10);
    expect(r.position[2]).toBe(0);
  });

  it("keeps fractional target weights self-financing after every trade", () => {
    const prices = [100, 100, 120, 90, 105];
    const signals = [0.5, 0.25, 0.8, 0, 0];
    const r = vectorizedBacktest(signals, prices, 1000, 0.01, 0.02);
    for (let i = 1; i < prices.length; i++) {
      expect(r.cash[i]).toBeGreaterThanOrEqual(-1e-10);
      expect(r.equity[i]).toBeCloseTo(r.cash[i] + r.position[i] * prices[i], 10);
      expect(r.position[i] * prices[i] / r.equity[i]).toBeCloseTo(signals[i - 1], 10);
      expect(r.cash[i]).toBeCloseTo(r.cash[i - 1] - r.trade[i] * prices[i] - r.cost[i], 10);
    }
  });

  it("rejects invalid lengths, nonfinite prices, weights, and fee rates", () => {
    for (const prices of [[100, 0], [100, NaN], [100, Infinity], [100, -1]]) {
      expect(() => vectorizedBacktest([1, 1], prices)).toThrow();
    }
    expect(() => vectorizedBacktest([1], [100, 101])).toThrow();
    expect(() => vectorizedBacktest([2, 0], [100, 101])).toThrow();
    expect(() => vectorizedBacktest([1, 1], [100, 101], 1000, -0.1)).toThrow();
  });
});

describe("independent performance definitions", () => {
  it("compounds alternating gains and losses instead of annualizing their mean", () => {
    const r = report([0.1, -0.1]);
    expect(r.totalReturn).toBeCloseTo(-0.01, 12);
    expect(r.cagr).toBeCloseTo(0.99 ** 126 - 1, 12);
    expect(r.calmar).toBeCloseTo((0.99 ** 126 - 1) / 0.1, 10);
  });

  it("uses elapsed calendar years when supplied", () => {
    expect(report([0.1, -0.1], undefined, { elapsedYears: 1 }).cagr).toBeCloseTo(-0.01, 12);
    expect(report([0.1, -0.1], undefined, { elapsedYears: 2 }).cagr).toBeCloseTo(Math.sqrt(0.99) - 1, 12);
  });

  it("measures downside against a target over all periods, even with one loss", () => {
    // mean .005, downside sqrt((0 + .01^2)/2).
    expect(sortino([0.02, -0.01], 0)).toBeCloseTo(0.005 / Math.sqrt(0.0001 / 2) * Math.sqrt(252), 10);
  });

  it("marks undefined ratios absent instead of manufacturing zero or Infinity", () => {
    const r = report([0, 0]);
    expect(r.sharpe).toBeNull();
    expect(r.sortino).toBeNull();
    expect(r.calmar).toBeNull();
    expect(r.pnlRatio).toBeNull();
    expect(JSON.stringify(r)).not.toContain("NaN");
  });

  it("rejects mismatched periods and invalid returns rather than filtering them", () => {
    expect(() => report([0.1, -0.1], [0.1])).toThrow();
    expect(() => report([0.1, NaN])).toThrow();
    expect(() => report([0.1, -1.1])).toThrow();
    expect(() => report([0.1, 0.1], undefined, { elapsedYears: 0 })).toThrow();
  });

  it("resets drawdown duration when equity exactly regains its peak", () => {
    expect(maxDdDuration([-0.5, 1, -0.5, 1])).toBe(1);
  });

  it("shares geometric CAGR with benchmark scoring", () => {
    const r = evaluate({ returns: [0.1, -0.1] }, { returns: [0, 0] });
    expect(r.details.cagr).toBeCloseTo(0.99 ** 126 - 1, 4);
    expect(r.details.excessReturn).toBeCloseTo(r.details.cagr, 4);
  });

  it("uses matching actual valuation dates for benchmark annualization", () => {
    const dates = ["2024-01-01", "2024-07-01", "2025-01-01"];
    const result = evaluate({ returns: [0.1, -0.1], dates }, { returns: [0, 0], dates });
    expect(result.details.cagr).toBeCloseTo(0.99 ** (365.25 / 366) - 1, 4);
    expect(() => evaluate({ returns: [0.1, -0.1], dates }, { returns: [0, 0], dates: ["2024-01-01", "2024-08-01", "2025-01-01"] })).toThrow();
    expect(() => evaluate({ returns: [0.1, -0.1] }, { returns: [0] })).toThrow();
    expect(() => calendarYears(["2024-02-30", "2025-01-01"])).toThrow();
    expect(() => calendarYears(["2024-01-01", "2024-01-01"])).toThrow();
  });

  it("keeps risk and return reports on the same downside and drawdown basis", () => {
    const r = metrics([0.02, -0.01]);
    expect(r.downsideVol).toBeCloseTo(Math.sqrt(0.0001 / 2) * Math.sqrt(252), 12);
    expect(r.skewness).toBeCloseTo(0, 12);
    expect(r.kurtosis).toBeCloseTo(-2, 12);
    expect(metrics([-0.5, 1, -0.5, 1]).maxDdDays).toBe(1);
    expect(metrics([0.02, -0.01], 52).annualVol).toBeCloseTo(Math.sqrt(0.00045 * 52), 12);
    expect(() => metrics([0.02, -0.01], 0)).toThrow();
  });

  it("preserves unavailable Sharpe in saved-result summaries", () => {
    const rows = collectResults([{ strategy: "flat", totalScore: 0, details: { sharpe: null } }, { strategy: "varied", totalScore: 40, details: { sharpe: 2 } }]);
    expect(rows[0].sharpe).toBeNull();
    expect(dashboardSummary(rows).avgSharpe).toBe(2);
    expect(dashboardSummary(rows.slice(0, 1)).avgSharpe).toBeNull();
  });
});
