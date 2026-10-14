import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { createPriceAnalysisTools } from "../quant-tools.ts";
import { verifyResearchAnalysis } from "../../research/analysis.ts";
import type { ResearchBarsDataset } from "../../research/types.ts";
import type { Bar } from "../../types/data.ts";
import type { FactorName } from "../../quant/factor.ts";

function bars(close: number[]): Bar[] {
  return close.map((value, index) => ({ date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    open: value, high: value, low: value, close: value, volume: 10, amount: value * 10 }));
}
function dataset(close: number[]): ResearchBarsDataset {
  const observations = bars(close);
  return { bars: observations, ref: { version: 1, kind: "daily-bars", symbol: "AAPL", market: "US", source: "financial-datasets",
    revision: "a".repeat(64), contentHash: createHash("sha256").update(JSON.stringify(observations)).digest("hex"),
    dates: observations.map(bar => bar.date), requested: { start: null, end: null }, snapshotAt: "2026-03-01T00:00:00.000Z",
    adjustment: "provider-unspecified", availability: "observed-at-fetch" } };
}

const matrix: Array<{ factor: FactorName; period: number; expected: number }> = [
  { factor: "momentum", period: 2, expected: -13 / 137 }, { factor: "reversal", period: 2, expected: 13 / 137 },
  { factor: "volatility", period: 2, expected: (1 / 137 + 7 / 69) / Math.sqrt(2) },
  { factor: "volume_ratio", period: 20, expected: 1 }, { factor: "rsi", period: 14, expected: 1300 / 27 },
  { factor: "sma_deviation", period: 20, expected: 21 / 515 },
];
it.each(matrix)("the actual compute_factor tool and verifier agree with independent $factor arithmetic", async ({ factor, period, expected }) => {
  const observations = dataset(Array.from({ length: 40 }, (_, index) => index === 39 ? 124 : 100 + index));
  const before = structuredClone(observations);
  const tool = createPriceAnalysisTools(async () => ({ bars: observations.bars, dataset: observations.ref,
    source: "financial-datasets", origin: "cache", asOfDate: observations.ref.dates.at(-1)!, attempts: [] })).computeFactorTool;
  const args = { symbol: "AAPL", factor, period };
  const result = await tool.execute("matrix", args);
  const saved = result.details as Record<string, unknown>;
  expect(saved.last).toBeCloseTo(expected, 12);
  const analysis = verifyResearchAnalysis("compute_factor", args, saved, { input: 0 }, [observations]);
  expect(analysis.metrics.find(item => item.label === "Latest")!.value).toBeCloseTo(expected, 12);
  expect(observations).toEqual(before);
});

it("rechecks an RSI archive and rejects the old delayed-Wilder result without rewriting its input", () => {
  const observations = dataset([10, 11, 12, 11, 10]);
  const args = { symbol: "AAPL", factor: "rsi", period: 2 };
  const saved = { symbol: "AAPL", source: "financial-datasets", factor: "rsi", period: 2,
    asOfDate: "2026-01-05", last: 25, mean: 75, percentile: 0 };
  const legacy = { ...saved, last: 50, mean: 100 };
  const before = structuredClone({ observations, legacy });
  expect(verifyResearchAnalysis("compute_factor", args, saved, { input: 0 }, [observations]).metrics.map(item => item.value))
    .toEqual([25, 75, 0]);
  expect(() => verifyResearchAnalysis("compute_factor", args, legacy, { input: 0 }, [observations])).toThrow("Factor result mismatch");
  expect({ observations, legacy }).toEqual(before);
});

it("prepares the fixed SMA(5) window and rejects a too-short archive instead of inventing -100%", async () => {
  const observations = dataset([100, 101, 102]);
  let requestedMinimum = 0;
  const tool = createPriceAnalysisTools(async (_symbol, minimum) => {
    requestedMinimum = minimum;
    return { bars: observations.bars, source: "financial-datasets", origin: "cache", asOfDate: "2026-01-03", attempts: [] };
  }).computeFactorTool;
  const args = { symbol: "AAPL", factor: "sma_deviation" as const, period: 2 };
  const result = await tool.execute("short-sma", args);
  expect(requestedMinimum).toBe(5);
  expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("Need 5+ bars") })]));
  expect(() => verifyResearchAnalysis("compute_factor", args, { symbol: "AAPL", source: "financial-datasets" }, { input: 0 }, [observations]))
    .toThrow("Invalid factor parameters");
});
