import { describe, expect, it, mock } from "bun:test";
import type { Bar } from "../../types/data.ts";
import {
  fetchBars,
  fetchLiveBars,
  filterBarsByDate,
  formatRefreshMinute,
  formatSourceLabels,
  pullBarsFromProviders,
} from "../src/sources.ts";
import type { BarProviderAdapter, SourceProviderOptions, SourceRuntimeDeps } from "../src/source-contracts.ts";

const SAMPLE_BARS: Bar[] = [
  { date: "2026-06-06", open: 1, high: 1, low: 1, close: 10, volume: 0, amount: 0 },
  { date: "2026-06-07", open: 1, high: 1, low: 1, close: 10.5, volume: 0, amount: 0 },
  { date: "2026-06-08", open: 1, high: 1, low: 1, close: 11, volume: 0, amount: 0 },
];

function aShareProviders(
  akshare: BarProviderAdapter["fetchBars"],
  tushare: BarProviderAdapter["fetchBars"],
  options: Omit<SourceProviderOptions, "adapters"> = {},
): SourceProviderOptions {
  return {
    ...options,
    adapters: {
      akshare: { fetchBars: akshare },
      tushare: { fetchBars: tushare },
    },
  };
}

function runtimeDeps(overrides: Partial<SourceRuntimeDeps> = {}): SourceRuntimeDeps {
  return {
    loadBars: async () => [],
    saveBars: async () => {},
    isCacheFresh: async () => false,
    getPreferredSource: () => "akshare",
    ...overrides,
  };
}

describe("source attribution helpers", () => {
  it("formats single, duplicate, and unavailable providers", () => {
    expect(formatSourceLabels(["akshare"])).toBe("AKShare");
    expect(formatSourceLabels(["akshare", "akshare"])).toBe("AKShare");
    expect(formatSourceLabels(["unavailable"])).toBe("暂无数据");
  });

  it("formats refresh time to minute precision", () => {
    expect(formatRefreshMinute(new Date(2026, 5, 8, 14, 32, 59))).toBe("2026-06-08 14:32");
  });

  it("filters bars with inclusive bounds", () => {
    expect(filterBarsByDate(SAMPLE_BARS, "2026-06-07", "2026-06-08").map((bar) => bar.date))
      .toEqual(["2026-06-07", "2026-06-08"]);
    expect(filterBarsByDate(SAMPLE_BARS)).toHaveLength(3);
  });
});

describe("pullBarsFromProviders", () => {
  it("prefers AKShare for A-shares by default", async () => {
    const result = await pullBarsFromProviders(
      "000300.SH", "A", undefined, undefined, "auto",
      aShareProviders(async () => SAMPLE_BARS, async () => []),
    );
    expect(result.source).toBe("akshare");
    expect(result.bars.at(-1)?.close).toBe(11);
    expect(result.attempts).toEqual([{ source: "akshare", status: "success" }]);
  });

  it("puts the selected provider first", async () => {
    const tushareBars = [{ ...SAMPLE_BARS[0]!, close: 20 }];
    const result = await pullBarsFromProviders(
      "000300.SH", "A", undefined, undefined, "tushare",
      aShareProviders(async () => SAMPLE_BARS, async () => tushareBars),
    );
    expect(result.source).toBe("tushare");
    expect(result.bars[0]?.close).toBe(20);
  });

  it("normalizes provider bars into a sorted, deduplicated daily series", async () => {
    const result = await pullBarsFromProviders(
      "000300.SH", "A", undefined, undefined, "akshare",
      aShareProviders(async () => [
        { ...SAMPLE_BARS[2]!, date: "20260608", close: 11 },
        { ...SAMPLE_BARS[0]!, date: "2026-06-06T15:00:00+08:00", close: 10 },
        { ...SAMPLE_BARS[2]!, date: "2026-06-08", close: 11.2 },
      ], async () => []),
    );
    expect(result.bars.map((bar) => [bar.date, bar.close])).toEqual([
      ["2026-06-06", 10],
      ["2026-06-08", 11.2],
    ]);
  });

  it("falls back when a provider ignores the requested date window", async () => {
    const result = await pullBarsFromProviders(
      "000300.SH", "A", "2026-06-07", "2026-06-08", "akshare",
      aShareProviders(
        async () => [{ ...SAMPLE_BARS[0]!, date: "2020-01-01" }],
        async () => SAMPLE_BARS,
      ),
    );
    expect(result.source).toBe("tushare");
    expect(result.bars.map((bar) => bar.date)).toEqual(["2026-06-07", "2026-06-08"]);
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(["empty", "success"]);
  });

  it("falls back after provider errors and empty results", async () => {
    const afterError = await pullBarsFromProviders(
      "000300.SH", "A", undefined, undefined, "tushare",
      aShareProviders(async () => SAMPLE_BARS, async () => { throw new Error("offline"); }),
    );
    expect(afterError.source).toBe("akshare");
    expect(afterError.attempts.map((attempt) => attempt.status)).toEqual(["error", "success"]);

    const afterEmpty = await pullBarsFromProviders(
      "000300.SH", "A", undefined, undefined, "auto",
      aShareProviders(async () => [], async () => [SAMPLE_BARS.at(-1)!]),
    );
    expect(afterEmpty.source).toBe("tushare");
    expect(afterEmpty.attempts.map((attempt) => attempt.status)).toEqual(["empty", "success"]);
  });

  it("returns unavailable with diagnostics when every provider misses", async () => {
    const empty = await pullBarsFromProviders(
      "000300.SH", "A", undefined, undefined, "auto",
      aShareProviders(async () => [], async () => []),
    );
    expect(empty).toEqual({
      bars: [],
      source: "unavailable",
      attempts: [
        { source: "akshare", status: "empty" },
        { source: "tushare", status: "empty" },
      ],
    });

    const failed = await pullBarsFromProviders(
      "000300.SH", "A", undefined, undefined, "auto",
      aShareProviders(
        async () => { throw new Error("AKShare offline"); },
        async () => { throw new Error("Tushare offline"); },
      ),
    );
    expect(failed.source).toBe("unavailable");
    expect(failed.attempts.map((attempt) => attempt.status)).toEqual(["error", "error"]);
  });

  it("replaces adapters per call and normalizes symbols", async () => {
    const replacement = mock(async (_request: { symbol: string; market: string }) => SAMPLE_BARS);
    const result = await pullBarsFromProviders(
      "600000", "A", undefined, undefined, "akshare",
      aShareProviders(replacement, async () => []),
    );
    expect(result.source).toBe("akshare");
    expect(replacement.mock.calls[0]?.[0]).toMatchObject({ symbol: "600000.SH", market: "A" });
  });

  it("preserves open-fund suffixes while normalizing exchange-traded symbols", async () => {
    const seen: string[] = [];
    const provider = async (request: { symbol: string }) => {
      seen.push(request.symbol);
      return SAMPLE_BARS;
    };
    const providers = aShareProviders(provider, async () => []);

    await pullBarsFromProviders("022364.OF", "A", undefined, undefined, "akshare", providers);
    await pullBarsFromProviders("159995", "A", undefined, undefined, "akshare", providers);
    await pullBarsFromProviders("510300", "A", undefined, undefined, "akshare", providers);
    await pullBarsFromProviders("000001", "A", undefined, undefined, "akshare", providers);

    expect(seen).toEqual(["022364.OF", "159995.SZ", "510300.SH", "000001.SZ"]);
  });

  it("supports custom order and redacts provider diagnostics", async () => {
    const providers = aShareProviders(
      async () => SAMPLE_BARS,
      async () => { throw new Error("offline\nhttps://data.test?q=1&token=secret Bearer abc123"); },
      { fallbackOrder: { A: ["tushare", "akshare"] } },
    );
    const result = await pullBarsFromProviders("000300.SH", "A", undefined, undefined, "auto", providers);
    expect(result.source).toBe("akshare");
    expect(result.attempts).toEqual([
      {
        source: "tushare",
        status: "error",
        error: "offline https://data.test?q=1&token=[redacted] Bearer [redacted]",
      },
      { source: "akshare", status: "success" },
    ]);
  });

  it("uses the market default when an order override is empty", async () => {
    const result = await pullBarsFromProviders(
      "000300.SH", "A", undefined, undefined, "auto",
      aShareProviders(async () => [], async () => SAMPLE_BARS, { fallbackOrder: { A: [] } }),
    );
    expect(result.source).toBe("tushare");
    expect(result.attempts.map((attempt) => attempt.source)).toEqual(["akshare", "tushare"]);
  });
});

describe("fetchBars", () => {
  it("uses a fresh injected cache without touching providers", async () => {
    const saveBars = mock(async () => {});
    const deps = runtimeDeps({
      loadBars: mock(async () => SAMPLE_BARS),
      saveBars,
      isCacheFresh: mock(async () => true),
    });
    const result = await fetchBars("000300.SH", "A", "2026-06-07", "2026-06-08", "auto", { deps });
    expect(result).toEqual({ bars: SAMPLE_BARS.slice(1), source: "akshare" });
    expect(saveBars).not.toHaveBeenCalled();
  });

  it("returns and caches the provider that actually succeeded", async () => {
    const saveBars = mock(async (_symbol: string, _source: string, _bars: Bar[]) => {});
    const result = await fetchBars("000300.SH", "A", undefined, undefined, "auto", {
      deps: runtimeDeps({ saveBars }),
      providers: aShareProviders(
        async () => { throw new Error("offline"); },
        async () => SAMPLE_BARS,
      ),
    });
    expect(result.source).toBe("tushare");
    expect(saveBars).toHaveBeenCalledWith("000300.SH", "tushare", SAMPLE_BARS);
  });

  it("skips out-of-range caches and does not rewrite cached bars", async () => {
    const saveBars = mock(async () => {});
    const deps = runtimeDeps({
      loadBars: mock(async (_symbol: string, source: string) => source === "akshare"
        ? [{ ...SAMPLE_BARS[0]!, date: "2020-01-01" }]
        : source === "tushare" ? SAMPLE_BARS : []),
      saveBars,
    });
    const result = await fetchBars("000300.SH", "A", "2026-06-07", "2026-06-08", "auto", {
      deps,
      providers: aShareProviders(async () => [], async () => []),
    });
    expect(result).toEqual({ bars: SAMPLE_BARS.slice(1), source: "tushare" });
    expect(saveBars).not.toHaveBeenCalled();
  });
});

describe("fetchLiveBars", () => {
  it("keeps the open-fund symbol on the date-window retry path", async () => {
    const seen: string[] = [];
    const akshare = async (request: { symbol: string; start?: string; end?: string }) => {
      seen.push(`${request.symbol}:${request.start || "all"}:${request.end || "all"}`);
      return request.start ? [] : SAMPLE_BARS;
    };

    const result = await fetchLiveBars("022364.OF", "A", "2030-01-01", "2030-01-31", {
      providers: aShareProviders(akshare, async () => []),
    });

    expect(result.source).toBe("akshare");
    expect(seen).toEqual([
      "022364.OF:2030-01-01:2030-01-31",
      "022364.OF:all:all",
    ]);
  });

  it("falls through the live path when AKShare is empty", async () => {
    const result = await fetchLiveBars("000300.SH", "A", undefined, undefined, {
      deps: runtimeDeps(),
      providers: aShareProviders(async () => [], async () => SAMPLE_BARS),
    });
    expect(result).toEqual({ bars: SAMPLE_BARS, source: "tushare", asOfDate: "2026-06-08" });
  });

  it("filters dates and reports the latest provider date", async () => {
    const result = await fetchLiveBars("000300.SH", "A", "2026-06-07", "2026-06-08", {
      providers: aShareProviders(async () => SAMPLE_BARS, async () => []),
    });
    expect(result.source).toBe("akshare");
    expect(result.asOfDate).toBe("2026-06-08");
    expect(result.bars).toEqual(SAMPLE_BARS.slice(1));
  });

  it("retries without a date window when the requested window is empty", async () => {
    const result = await fetchLiveBars("000300.SH", "A", "2030-01-01", "2030-01-31", {
      providers: aShareProviders(async () => SAMPLE_BARS, async () => []),
    });
    expect(result).toEqual({ bars: SAMPLE_BARS, source: "akshare", asOfDate: "2026-06-08" });
  });
});
