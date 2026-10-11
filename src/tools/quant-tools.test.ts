import * as sourceRuntime from "../runtime/source-runtime.ts";
import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { loadDataset, saveBars } from "../storage/index.ts";
import type { Bar } from "../types/data.ts";
import {
  COMPUTE_TOOLS,
  checkRiskTool,
  createPriceAnalysisTools,
  computeFactorTool,
  runBacktestTool,
  scoreBenchmarkTool,
  showDashboardTool,
} from "./quant-tools.ts";

const OHQ = join(process.cwd(), ".ohquant-test-quant-tools");

function resetOhq(): void {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
}

function cleanupOhq(): void {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
}

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .map((part) => part.type === "text" ? part.text : "")
    .join("\n");
}

function makeBars(count: number, startClose = 100, step = 0.35): Bar[] {
  const start = new Date(Date.UTC(2026, 0, 1));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const close = startClose + i * step + Math.sin(i / 5) * 0.8;
    return {
      date: d.toISOString().slice(0, 10),
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.6,
      close,
      volume: 1_000_000 + i * 1000,
      amount: close * (1_000_000 + i * 1000),
    };
  });
}

async function writeCachedBars(symbol: string, source: string, bars: Bar[]): Promise<void> {
  await saveBars(symbol, source, bars, "1900-01-01");
}

beforeEach(() => resetOhq());
afterAll(() => cleanupOhq());

describe("built-in quant tool catalog", () => {
  it("registers the built-in quant tools as sequential agent tools", () => {
    expect(COMPUTE_TOOLS.map((tool) => tool.name)).toEqual([
      "compute_factor",
      "run_backtest",
      "check_risk",
      "fund_dca_backtest",
      "score_benchmark",
      "show_dashboard",
    ]);
    expect(COMPUTE_TOOLS.every((tool) => tool.executionMode === "sequential")).toBe(true);
  });
});

describe("compute_factor", () => {
  it("accepts a matching current-market identity without switching to archive mode", async () => {
    let loads = 0;
    const tools = createPriceAnalysisTools(async () => {
      loads++;
      return { bars: makeBars(80), source: "akshare" as const, origin: "provider" as const,
        asOfDate: "2026-03-21", attempts: [] };
    });
    const valid = await tools.computeFactorTool.execute("current-market", { symbol: "AAPL", market: "US", factor: "momentum", period: 2 });
    expect(resultText(valid)).toContain("Latest");
    expect(loads).toBe(1);
    const wrongMarket = await tools.computeFactorTool.execute("wrong-market", { symbol: "AAPL", market: "A", factor: "momentum", period: 2 });
    const wrongSource = await tools.computeFactorTool.execute("wrong-source", { symbol: "AAPL", market: "US", source: "akshare", factor: "momentum", period: 2 });
    expect(resultText(wrongMarket)).toContain("symbol/market identity is invalid");
    expect(resultText(wrongSource)).toContain("source is only used with observed_before");
    expect(loads).toBe(1);
  });
  it("rejects invalid historical windows before requesting data", async () => {
    const fetch = spyOn(sourceRuntime, "fetchBars");
    try {
      for (const window of [{ start: "2026-02-30", end: "2026-03-01" }, { start: "2026-02-01", end: "2026-01-01" }]) {
        await expect(computeFactorTool.execute("invalid-window", { symbol: "AAPL", factor: "momentum", period: 2, ...window })).rejects.toThrow();
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it("requests missing bars automatically and reports insufficient data", async () => {
    const fetch = spyOn(sourceRuntime, "fetchBars").mockResolvedValue({ bars: [], source: "unavailable", origin: "unavailable", asOfDate: "", attempts: [] });
    try {
      const result = await computeFactorTool.execute("t1", { symbol: "000001.SZ", factor: "momentum", period: 20 });
      expect(fetch).toHaveBeenCalled();
      expect(resultText(result)).toContain("Not enough bars");
      expect(resultText(result)).toContain("requested automatically");
    } finally { fetch.mockRestore(); }
  });

  it("computes factor metrics from cached bars", async () => {
    await writeCachedBars("000001.SZ", "akshare", makeBars(80));

    const result = await computeFactorTool.execute("t1", {
      symbol: "000001.SZ",
      factor: "momentum",
      period: 20,
    });

    const text = resultText(result);
    expect(text).toContain("Factor  000001.SZ  momentum_20");
    expect(text).toContain("Source      akshare");
    expect(text).toContain("price date 2026-03-21");
    expect(text).toContain("observed-at-fetch");
    expect(result.details).toMatchObject({ latestBarDate: "2026-03-21", historicalAvailability: "observed-at-fetch" });
    expect((result.details as { observationAt: string }).observationAt.slice(0, 10)).not.toBe("2026-03-21");
    expect(text).toContain("Percentile");
    expect(text).toContain("do not test subsequent returns, mean reversion");
    expect(result.details).toMatchObject({ evidenceBoundary: expect.stringContaining("Momentum is a trailing price return") });
    expect((result.details as { symbol?: string }).symbol).toBe("000001.SZ");
    expect((result.details as { factor?: string }).factor).toBe("momentum");
    const reversal = await computeFactorTool.execute("reversal", { symbol: "000001.SZ", factor: "reversal", period: 2 });
    expect(resultText(reversal)).toContain("negative of a trailing price return, not an observed price reversal");
  });

  it("marks prior statistics unavailable at the minimum factor window", async () => {
    const bars = makeBars(3);
    const { computeFactorTool } = createPriceAnalysisTools(async () => ({ bars, source: "akshare" as const,
      origin: "provider" as const, asOfDate: bars.at(-1)!.date, attempts: [] }));
    const result = await computeFactorTool.execute("one-value", { symbol: "000001.SZ", factor: "momentum", period: 2 });
    expect(result.details).toMatchObject({ last: expect.any(Number), mean: null, percentile: null });
    expect(resultText(result)).toContain("Mean        N/A (no prior factor values)");
    expect(resultText(result)).toContain("Percentile  N/A (no prior factor values)");
  });
});

it("separates maximum drawdown depth from the longest underwater period", async () => {
  const closes = [...Array<number>(30).fill(100), 50, 100, 99, 99, 99, 100];
  const bars = makeBars(closes.length).map((bar, index) => ({ ...bar,
    open: closes[index]!, high: closes[index]!, low: closes[index]!, close: closes[index]! }));
  const { checkRiskTool } = createPriceAnalysisTools(async () => ({ bars, source: "akshare" as const,
    origin: "provider" as const, asOfDate: bars.at(-1)!.date, attempts: [] }));
  const result = await checkRiskTool.execute("duration", { symbol: "AAPL", market: "US" });
  const lines = resultText(result).split("\n");
  expect(lines.find(line => line.startsWith("Max DD"))).toContain("-50.00%");
  expect(lines.find(line => line.startsWith("Max DD"))).not.toContain("periods");
  expect(lines.find(line => line.startsWith("Longest underwater"))).toContain("3 observed periods");
  expect(result.details).toMatchObject({ maxDrawdown: -0.5, maxDdDays: 3 });
});

describe("run_backtest", () => {
  it("forwards cancellation to data preparation and rejects a late result", async () => {
    const controller = new AbortController();
    const fetch = spyOn(sourceRuntime, "fetchBars").mockImplementation(async (_symbol, _market, _start, _end, _source, options) => {
      expect(options?.providers?.signal).toBe(controller.signal);
      controller.abort(new Error("Research cancelled"));
      return { bars: makeBars(80), source: "akshare", origin: "provider", asOfDate: "2026-03-21", attempts: [] };
    });
    try {
      await expect(runBacktestTool.execute("cancelled", { symbol: "000002.SZ" }, controller.signal)).rejects.toThrow("Research cancelled");
    } finally { fetch.mockRestore(); }
  });
  it("exposes the hand-computed ledger, explicit costs and actual calendar span", async () => {
    const bars = makeBars(12).map((bar, i) => ({ ...bar, open: 100 + i * 10, high: 100 + i * 10, low: 100 + i * 10, close: 100 + i * 10 }));
    await writeCachedBars("000002.SZ", "akshare", bars);
    const result = await runBacktestTool.execute("ledger", { symbol: "000002.SZ", fast: 1, slow: 2, cash: 1200, commission: 0, stamp_duty: 0 });
    const details = result.details as { totalReturn: number; cagr: number; ledger: { equity: number[]; position: number[] }; assumptions: { commission: number; stampDuty: number } };
    // First signal at 110 executes at the next close, 120: ten shares, final close 210.
    expect(details.ledger.position[1]).toBe(0);
    expect(details.ledger.position[2]).toBe(10);
    expect(details.ledger.equity.at(-1)).toBe(2100);
    expect(details.totalReturn).toBeCloseTo(0.75, 12);
    expect(details.cagr / (1.75 ** (365.25 / 11) - 1)).toBeCloseTo(1, 10);
    expect(details.assumptions.commission).toBe(0);
    expect(details.assumptions.stampDuty).toBe(0);
    expect(resultText(result)).toContain("next close");
    expect(resultText(result)).toContain("price date 2026-01-12");
    expect(result.details).toMatchObject({ latestBarDate: "2026-01-12", historicalAvailability: "observed-at-fetch" });
  });

  it("rejects cached data that is too short for the slow window", async () => {
    await writeCachedBars("000002.SZ", "akshare", makeBars(12));

    const result = await runBacktestTool.execute("t1", {
      symbol: "000002.SZ",
      fast: 5,
      slow: 20,
      cash: 100_000,
    });

    expect(resultText(result)).toContain("Not enough bars for the requested analysis");
    expect(resultText(result)).toContain("SMA(5,20)");
  });

  it("runs an SMA backtest from cached bars", async () => {
    await writeCachedBars("000002.SZ", "tushare", makeBars(90, 50, 0.2));

    const result = await runBacktestTool.execute("t1", {
      symbol: "000002.SZ",
      fast: 5,
      slow: 20,
      cash: 100_000,
    });

    const text = resultText(result);
    expect(text).toContain("Backtest  000002.SZ  SMA(5,20)");
    expect(text).toContain("Source        tushare");
    expect(text).toContain("Total return");
    expect(text).toContain("Sharpe");
    expect((result.details as { symbol?: string }).symbol).toBe("000002.SZ");
  });
});

describe("check_risk", () => {
  it("distinguishes closing observations from return intervals and includes quantile ties in the tail", async () => {
    const bars = makeBars(40).map((bar, index) => {
      const close = [100, 110, 88, 99][index % 4]!;
      return { ...bar, open: close, high: close, low: close, close, amount: close * bar.volume };
    });
    const tool = createPriceAnalysisTools(async () => ({ bars, source: "financial-datasets", origin: "provider",
      asOfDate: bars.at(-1)!.date, attempts: [] })).checkRiskTool;
    const text = resultText(await tool.execute("sample-counts", { symbol: "AAPL" }));
    expect(text).toContain("40 closing observations · 39 return intervals");
    expect(text).toContain("10/39 return intervals at or below historical VaR 95 (including ties)");
    expect(text).toContain("actual sample tail can exceed 5%");
  });
  it("computes risk metrics from cached bars", async () => {
    await writeCachedBars("000003.SZ", "tushare", makeBars(90, 20, 0.12));

    const result = await checkRiskTool.execute("t1", { symbol: "000003.SZ" });

    const text = resultText(result);
    expect(text).toContain("Risk  000003.SZ");
    expect(text).toContain("Source        tushare");
    expect(text).toContain("Annual vol");
    expect(text).toContain("VaR 95");
    expect(text).toContain("price date 2026-03-31");
    expect(result.details).toMatchObject({ latestBarDate: "2026-03-31", historicalAvailability: "observed-at-fetch" });
    expect((result.details as { symbol?: string }).symbol).toBe("000003.SZ");
    expect(typeof (result.details as { annualVol?: number }).annualVol).toBe("number");
  });
});

describe("score_benchmark and show_dashboard", () => {
  it("labels cross-market scores as quoted-price comparisons without FX conversion", async () => {
    await writeCachedBars("AAPL", "akshare", makeBars(120, 80, 0.25));
    await writeCachedBars("000300.SH", "akshare", makeBars(120, 100, 0.08));
    const result = await scoreBenchmarkTool.execute("cross-market", {
      symbol: "AAPL", benchmark_symbol: "000300.SH", fast: 5, slow: 20,
    });
    expect(resultText(result)).toContain("without FX conversion");
    expect(resultText(result)).toContain("not a common-currency investor return");
    const filename = (result.details as { filename: string }).filename;
    const saved = JSON.parse(readFileSync(join(OHQ, "benchmark", "results", filename), "utf8"));
    expect(saved.assumptions.priceBasis).toBe("provider-close-no-fx");
    expect(saved.source.strategy.market).toBe("US");
    expect(saved.source.benchmark.market).toBe("A");
  });

  it("scores from cached bars, writes an artifact, and dashboard reads it back", async () => {
    await writeCachedBars("000004.SZ", "akshare", makeBars(120, 30, 0.16));
    await writeCachedBars("000300.SH", "akshare", makeBars(120, 100, 0.08));

    const score = await scoreBenchmarkTool.execute("t1", {
      symbol: "000004.SZ",
      benchmark_symbol: "000300.SH",
      fast: 5,
      slow: 20,
      cash: 100_000,
      label: "unit_sma",
    });

    const scoreText = resultText(score);
    expect(scoreText).toContain("Benchmark  unit_sma");
    expect(scoreText).toContain("Score");
    expect(scoreText).toContain("Saved         .ohquant/benchmark/results/unit_sma_");

    const filename = (score.details as { filename?: string }).filename;
    expect(filename).toMatch(/^unit_sma_\d{4}-\d{2}-\d{2}_[\da-f-]+\.json$/);
    const artifactPath = join(OHQ, "benchmark", "results", filename!);
    expect(existsSync(artifactPath)).toBe(true);

    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(artifact.strategy).toBe("unit_sma");
    expect(artifact.symbol).toBe("000004.SZ");
    expect(artifact.benchmark_symbol).toBe("000300.SH");
    expect(typeof artifact.totalScore).toBe("number");
    const originalBars = loadDataset(artifact.datasets.strategy);
    await saveBars("000004.SZ", "akshare", originalBars.map(bar => ({ ...bar, close: bar.close + 1 })));
    expect(loadDataset(artifact.datasets.strategy)).toEqual(originalBars);
    expect(artifact.datasets.strategy.revision).toMatch(/^[a-f0-9]{64}$/);

    const dashboard = await showDashboardTool.execute("t2", {});
    const dashboardText = resultText(dashboard);
    expect(dashboardText).toContain("Dashboard  1 evaluations");
    expect(dashboardText).toContain("Provider closes are not FX-converted");
    expect(dashboardText).toContain("Best unit_sma");
    expect(dashboardText).toContain("unit_sma");
    expect((dashboard.details as { summary?: { totalEvals?: number } }).summary?.totalEvals).toBe(1);
  });

  it("returns a helpful dashboard hint when no artifacts exist", async () => {
    const result = await showDashboardTool.execute("t1", {});
    expect(resultText(result)).toContain("No benchmark results yet");
  });
  it("uses benchmark defaults, preserves repeated runs, and contains label paths", async () => {
    await writeCachedBars("000004.SZ", "akshare", makeBars(280));
    await writeCachedBars("000300.SH", "akshare", makeBars(280, 90, 0.2));
    const first = await scoreBenchmarkTool.execute("b1", { symbol: "000004.SZ", label: "../../custom" });
    const second = await scoreBenchmarkTool.execute("b2", { symbol: "000004.SZ", label: "../../custom" });
    const firstName = (first.details as { filename: string }).filename;
    const secondName = (second.details as { filename: string }).filename;
    expect(firstName).not.toContain("/");
    expect(firstName).not.toBe(secondName);
    expect(existsSync(join(OHQ, "benchmark", "results", firstName))).toBe(true);
    expect(existsSync(join(OHQ, "benchmark", "results", secondName))).toBe(true);
    expect(resultText(await showDashboardTool.execute("d", {}))).toContain("2 evaluations");
  });

  it("honors the dashboard sort metric", async () => {
    const dir = join(OHQ, "benchmark", "results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.json"), JSON.stringify({ strategy: "high_score", totalScore: 90, details: { cagr: 0.1, sharpe: 1 } }));
    writeFileSync(join(dir, "b.json"), JSON.stringify({ strategy: "high_return", totalScore: 60, details: { cagr: 0.2, sharpe: 2 } }));
    const text = resultText(await showDashboardTool.execute("d", { sort_by: "cagr" }));
    const rows = text.split("\n").filter(row => row.includes("score="));
    expect(rows[0]).toContain("high_return");
  });

});
