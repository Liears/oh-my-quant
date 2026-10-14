import { describe, expect, it, mock, spyOn } from "bun:test";
import type { Bar } from "../../types/data.ts";
import {
  fetchBars,
  fetchLiveBars,
  filterBarsByDate,
  formatRefreshMinute,
  formatSourceLabels,
  pullBarsFromProviders,
  searchSymbols,
} from "../src/sources.ts";
import type { BarProviderAdapter, SourceProviderOptions, SourceRuntimeDeps } from "../src/source-contracts.ts";

const SAMPLE_BARS: Bar[] = [
  { date: "2026-06-06", open: 1, high: 20, low: 1, close: 10, volume: 0, amount: 0 },
  { date: "2026-06-07", open: 1, high: 20, low: 1, close: 10.5, volume: 0, amount: 0 },
  { date: "2026-06-08", open: 1, high: 20, low: 1, close: 11, volume: 0, amount: 0 },
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
    loadCache: async () => ({ bars: [], fresh: false }),
    saveBars: async () => {},
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
  it("reads host credentials only when a concrete paid adapter is dispatched", async () => {
    let loads = 0;
    const requests: unknown[] = [];
    const previousNoProxy = process.env.NO_PROXY;
    process.env.NO_PROXY = "127.0.0.1,localhost";
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
      requests.push(await request.json());
      return Response.json({ code: 0, data: { fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"],
        items: [["000001.SZ", "20260606", 10, 11, 9, 10.5, 100, 1000]] } });
    } });
    try {
      const result = await pullBarsFromProviders("000001.SZ", "A", "2026-06-06", "2026-06-06", "tushare", {
        fallbackOrder: { A: ["tushare"] }, budgetMs: 1000,
        loadCredentials: () => { loads++; return { tushare: { token: "local-test-token", baseUrl: `http://127.0.0.1:${server.port}` } }; },
      });
      expect(loads).toBe(1);
      expect(requests).toEqual([{ token: "local-test-token", api_name: "daily",
        params: { ts_code: "000001.SZ", start_date: "20260606", end_date: "20260606" },
        fields: "ts_code,trade_date,open,high,low,close,vol,amount" }]);
      expect(result).toMatchObject({ source: "tushare", bars: [{ date: "2026-06-06", close: 10.5 }] });
    } finally {
      server.stop(true);
      if (previousNoProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previousNoProxy;
    }
  });

  it("does not dispatch a paid HTTP request after synchronous credential loading exhausts the budget", async () => {
    const transport = spyOn(globalThis, "fetch").mockImplementation((async (_input, _init) => Response.json({ code: 0, data: { fields: [], items: [] } })) as typeof fetch);
    try {
      const result = await pullBarsFromProviders("000001.SZ", "A", "2026-06-06", "2026-06-06", "tushare", {
        fallbackOrder: { A: ["tushare"] }, budgetMs: 10,
        loadCredentials: () => {
          const until = performance.now() + 30;
          while (performance.now() < until) { /* Simulate synchronous settings decode. */ }
          return { tushare: { token: "local-test-token", baseUrl: "https://unit.test/tushare" } };
        },
      });
      expect(result).toMatchObject({ source: "unavailable", budgetExhausted: true,
        attempts: [{ source: "tushare", status: "error", error: "Provider request timed out" }] });
      expect(transport).not.toHaveBeenCalled();
    } finally { transport.mockRestore(); }
  });

  it("shares one budget across fallback attempts and accepts a fast second provider", async () => {
    const result = await pullBarsFromProviders("000300.SH", "A", undefined, undefined, "akshare",
      aShareProviders(async () => { throw new Error("offline"); }, async () => SAMPLE_BARS, { budgetMs: 100 }));
    expect(result.source).toBe("tushare");
    expect(result.budgetExhausted).toBeUndefined();
    expect(result.attempts.map(item => item.status)).toEqual(["error", "success"]);
  });

  it("stops an uncooperative adapter at the shared budget without dispatching a second provider", async () => {
    const fallback = mock(async () => SAMPLE_BARS);
    const started = performance.now();
    const result = await pullBarsFromProviders("000300.SH", "A", undefined, undefined, "akshare",
      aShareProviders(async () => new Promise<Bar[]>(() => {}), fallback, { budgetMs: 20 }));
    expect(performance.now() - started).toBeLessThan(500);
    expect(result).toMatchObject({ bars: [], source: "unavailable", budgetExhausted: true,
      attempts: [{ source: "akshare", status: "error", error: "Provider request timed out" }] });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("discards a response that arrives after the monotonic deadline even when the timer callback is delayed", async () => {
    const fallback = mock(async () => SAMPLE_BARS);
    const result = await pullBarsFromProviders("000300.SH", "A", undefined, undefined, "akshare",
      aShareProviders(async () => {
        const until = performance.now() + 35;
        while (performance.now() < until) { /* Simulate synchronous provider decoding. */ }
        return SAMPLE_BARS;
      }, fallback, { budgetMs: 10 }));
    expect(result.budgetExhausted).toBe(true);
    expect(result.bars).toEqual([]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("attributes a successful adapter response to its actual internal endpoint", async () => {
    const result = await pullBarsFromProviders(
      "000300.SH", "A", "2026-06-07", "2026-06-08", "akshare",
      aShareProviders(async () => ({ bars: SAMPLE_BARS, endpoint: "stock_zh_index_hist_csindex" }), async () => []),
    );
    expect(result.providerEndpoint).toBe("stock_zh_index_hist_csindex");
    expect(result.attempts).toEqual([{ source: "akshare", status: "success", providerEndpoint: "stock_zh_index_hist_csindex" }]);
    expect(result.bars).toEqual(SAMPLE_BARS.slice(1));
  });

  it("does not invent endpoint provenance for array responses or expose unsafe adapter labels", async () => {
    const result = await pullBarsFromProviders("000300.SH", "A", undefined, undefined, "akshare",
      aShareProviders(async () => ({ bars: SAMPLE_BARS, endpoint: "https://example.test?token=secret" }), async () => []));
    expect(result.source).toBe("akshare");
    expect(result.providerEndpoint).toBeUndefined();
    expect(result.attempts).toEqual([{ source: "akshare", status: "success" }]);
  });

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
        error: "Provider connection failed",
      },
      { source: "akshare", status: "success" },
    ]);
  });

  it("keeps useful failure categories without publishing arbitrary provider exception text", async () => {
    const privateText = "private-path-credential private-query-credential private-header-credential";
    const errors = [
      `HTTP 403 https://data.test/private-path-credential?session=private-query-credential X-Session: private-header-credential`,
      `timeout while reading https://data.test?custom=private-query-credential ${privateText}`,
      `unknown failure ${privateText}`,
    ];
    const categories: string[] = [];
    for (const message of errors) {
      const result = await pullBarsFromProviders("000300.SH", "A", undefined, undefined, "tushare",
        aShareProviders(async () => [], async () => { throw new Error(message); }, { fallbackOrder: { A: ["tushare"] } }));
      categories.push(result.attempts[0]?.error ?? "");
      for (const secret of ["private-path-credential", "private-query-credential", "private-header-credential"])
        expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(categories).toEqual(["HTTP 403", "Provider request timed out", "Provider request failed"]);
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
  it("uses visibly stale cache after a bounded failed refresh and never saves late provider rows", async () => {
    const save = mock(async () => {}), next = mock(async () => SAMPLE_BARS);
    const deps = runtimeDeps({ loadCache: async () => ({ bars: SAMPLE_BARS, fresh: false }), saveBars: save });
    const result = await fetchBars("000300.SH", "A", undefined, undefined, "auto", { deps,
      providers: aShareProviders(async () => {
        await new Promise(resolve => setTimeout(resolve, 80));
        return [{ ...SAMPLE_BARS[0]!, close: 19 }];
      }, next, { budgetMs: 15 }) });
    expect(result).toMatchObject({ source: "akshare", origin: "stale-cache", budgetExhausted: true });
    expect(result.bars).toEqual(SAMPLE_BARS);
    expect(next).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    await new Promise(resolve => setTimeout(resolve, 90));
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps caller cancellation distinct from timeout and does not fall back to cache", async () => {
    const controller = new AbortController(), cache = mock(async () => ({ bars: SAMPLE_BARS, fresh: false }));
    const pending = fetchBars("000300.SH", "A", undefined, undefined, "auto", { deps: runtimeDeps({ loadCache: cache }),
      providers: aShareProviders(async () => new Promise<Bar[]>(() => {}), async () => SAMPLE_BARS,
        { signal: controller.signal, budgetMs: 1000 }) });
    setTimeout(() => controller.abort(new Error("user cancelled")), 10);
    await expect(pending).rejects.toThrow("user cancelled");
    expect(cache).toHaveBeenCalledTimes(2); // Fresh-cache precheck only; no stale fallback after user cancel.
  });

  it("rejects invalid provider-chain budgets before contacting adapters", async () => {
    const contacted = mock(async () => SAMPLE_BARS);
    for (const budgetMs of [0, -1, 0.5, NaN, Infinity, 2_147_483_648]) {
      await expect(pullBarsFromProviders("000300.SH", "A", undefined, undefined, "akshare",
        aShareProviders(contacted, async () => [], { budgetMs }))).rejects.toThrow("Provider budget");
    }
    expect(contacted).not.toHaveBeenCalled();
  });

  it("passes the verified response endpoint to storage", async () => {
    const save = mock(async () => {});
    const provider = aShareProviders(async () => ({ bars: SAMPLE_BARS, endpoint: "stock_zh_index_hist_csindex" }), async () => []);
    const fetched = await fetchBars("000300.SH", "A", "2026-06-07", "2026-06-08", "akshare", {
      deps: runtimeDeps({ saveBars: save }), providers: provider,
    });
    expect(fetched.providerEndpoint).toBe("stock_zh_index_hist_csindex");
    expect(save).toHaveBeenCalledWith("000300.SH", "akshare", SAMPLE_BARS.slice(1), "2026-06-07", "2026-06-08", undefined, "stock_zh_index_hist_csindex");
  });

  it("uses a fresh injected cache without touching providers", async () => {
    const saveBars = mock(async () => {});
    const deps = runtimeDeps({
      loadCache: mock(async () => ({ bars: SAMPLE_BARS, fresh: true })),
      saveBars,
    });
    const result = await fetchBars("000300.SH", "A", "2026-06-07", "2026-06-08", "auto", { deps });
    expect(result).toMatchObject({ bars: SAMPLE_BARS.slice(1), source: "akshare", origin: "cache" });
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
    expect(saveBars).toHaveBeenCalledWith("000300.SH", "tushare", SAMPLE_BARS, undefined, undefined, undefined);
  });

  it("skips out-of-range caches and does not rewrite cached bars", async () => {
    const saveBars = mock(async () => {});
    const deps = runtimeDeps({
      loadCache: mock(async (_symbol: string, source: string) => ({ fresh: false, bars: source === "akshare"
        ? [{ ...SAMPLE_BARS[0]!, date: "2020-01-01" }]
        : source === "tushare" ? SAMPLE_BARS : [] })),
      saveBars,
    });
    const result = await fetchBars("000300.SH", "A", "2026-06-07", "2026-06-08", "auto", {
      deps,
      providers: aShareProviders(async () => [], async () => []),
    });
    expect(result).toMatchObject({ bars: SAMPLE_BARS.slice(1), source: "tushare", origin: "stale-cache" });
    expect(saveBars).not.toHaveBeenCalled();
  });
});

describe("fetchLiveBars", () => {
  it("does not restart an unrestricted live window after the requested provider chain exhausts its budget", async () => {
    const seen: string[] = [];
    const result = await fetchLiveBars("000300.SH", "A", "2026-06-07", "2026-06-08", { providers:
      aShareProviders(async request => { seen.push(request.start ?? "unrestricted"); return []; },
        async () => new Promise<Bar[]>(() => {}), { budgetMs: 15 }) });
    expect(result).toMatchObject({ bars: [], window: "unavailable", budgetExhausted: true });
    expect(seen).toEqual(["2026-06-07"]);
  });

  it("keeps the endpoint selected on a window retry", async () => {
    const result = await fetchLiveBars("000300.SH", "A", "2030-01-01", "2030-01-31", {
      providers: aShareProviders(async (request) => request.start ? [] : { bars: SAMPLE_BARS, endpoint: "stock_zh_index_hist_csindex" }, async () => []),
    });
    expect(result.providerEndpoint).toBe("stock_zh_index_hist_csindex");
    expect(result.window).toBe("latest-available");
  });

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
    expect(result).toEqual({ bars: SAMPLE_BARS, source: "tushare", asOfDate: "2026-06-08", window: "requested",
      attempts: [{ source: "akshare", status: "empty" }, { source: "tushare", status: "success" }] });
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
    expect(result).toEqual({ bars: SAMPLE_BARS, source: "akshare", asOfDate: "2026-06-08", window: "latest-available",
      attempts: [{ source: "akshare", status: "empty" }, { source: "tushare", status: "empty" }, { source: "akshare", status: "success" }] });
  });

  it("does not repeat failed authorization as an unrestricted date query", async () => {
    const failed = mock(async () => { throw new Error("HTTP 401"); });
    const result = await fetchLiveBars("AAPL", "US", "2025-01-06", "2025-01-17", {
      providers: { fallbackOrder: { US: ["llmquant-data", "financial-datasets"] },
        adapters: { "llmquant-data": { fetchBars: failed }, "financial-datasets": { fetchBars: failed } } },
    });
    expect(failed).toHaveBeenCalledTimes(2);
    expect(result.window).toBe("unavailable");
    expect(result.attempts.map(attempt => attempt.status)).toEqual(["error", "error"]);
  });
});

describe("source correctness regressions", () => {
  it("falls back from contradictory OHLC data and caches only the valid provider response", async () => {
    const valid: Bar = { date: "2026-01-06", open: 100, high: 110, low: 90, close: 105, volume: 12, amount: 1200 };
    const invalid: Bar = { ...valid, high: 80, low: 90 };
    const save = mock(async (_symbol: string, _source: string, _bars: Bar[]) => {});
    const result = await fetchBars("000001.SZ", "A", "2026-01-06", "2026-01-06", "auto", {
      deps: runtimeDeps({ saveBars: save }), providers: aShareProviders(async () => [invalid], async () => [valid]),
    });
    expect(result).toMatchObject({ source: "tushare", origin: "provider", bars: [valid] });
    expect(result.attempts.map(attempt => attempt.status)).toEqual(["empty", "success"]);
    expect(save).toHaveBeenCalledWith("000001.SZ", "tushare", [valid], "2026-01-06", "2026-01-06", undefined);
  });

  it("rejects a market/symbol mismatch before reading even a fresh cache", async () => {
    const loadCache = mock(async () => ({ bars: SAMPLE_BARS, fresh: true }));
    const save = mock(async () => {});
    const provider = mock(async () => SAMPLE_BARS);
    await expect(fetchBars("00700.HK", "US", undefined, undefined, "auto", {
      deps: runtimeDeps({ loadCache, saveBars: save }),
      providers: { adapters: { "llmquant-data": { fetchBars: provider } } },
    })).rejects.toThrow("market");
    expect(loadCache).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects a market/symbol mismatch before calling a selected provider", async () => {
    const provider = mock(async () => SAMPLE_BARS);
    await expect(pullBarsFromProviders("AAPL", "HK", undefined, undefined, "akshare", {
      adapters: { akshare: { fetchBars: provider } },
    })).rejects.toThrow("market");
    expect(provider).not.toHaveBeenCalled();
  });

  it("uses public AKShare after US auth/permission failures and caches only the actual provider", async () => {
    const save = mock(async (_symbol: string, _source: string, _bars: Bar[]) => {});
    const providers: SourceProviderOptions = { adapters: {
      "llmquant-data": { fetchBars: async () => { throw new Error("HTTP 401"); } },
      "financial-datasets": { fetchBars: async () => { throw new Error("HTTP 402"); } },
      akshare: { fetchBars: async () => SAMPLE_BARS },
    } };
    const result = await fetchBars("AAPL", "US", undefined, undefined, "auto", {
      deps: runtimeDeps({ getPreferredSource: () => "llmquant-data", saveBars: save }), providers,
    });
    expect(result).toMatchObject({ source: "akshare", origin: "provider", asOfDate: "2026-06-08" });
    expect(result.attempts.map(attempt => [attempt.source, attempt.status])).toEqual([
      ["llmquant-data", "error"], ["financial-datasets", "error"], ["akshare", "success"],
    ]);
    expect(save).toHaveBeenCalledWith("AAPL", "akshare", SAMPLE_BARS, undefined, undefined, undefined);
  });

  it("limits HK fallback to LLMQuant and AKShare and honors an explicit public source", async () => {
    const financial = mock(async () => SAMPLE_BARS);
    const providers: SourceProviderOptions = { adapters: {
      "llmquant-data": { fetchBars: async () => { throw new Error("HTTP 401"); } },
      "financial-datasets": { fetchBars: financial },
      akshare: { fetchBars: async () => SAMPLE_BARS },
    } };
    const fallback = await pullBarsFromProviders("00700.HK", "HK", undefined, undefined, "auto", providers);
    expect(fallback.source).toBe("akshare");
    expect(fallback.attempts.map(attempt => attempt.source)).toEqual(["llmquant-data", "akshare"]);
    const explicit = await pullBarsFromProviders("00700.HK", "HK", undefined, undefined, "akshare", providers);
    expect(explicit.attempts).toEqual([{ source: "akshare", status: "success" }]);
    expect(financial).not.toHaveBeenCalled();
  });

  it("stops US fallback before public AKShare when cancellation arrives after paid providers", async () => {
    const controller = new AbortController();
    const publicBars = mock(async () => SAMPLE_BARS);
    const providers: SourceProviderOptions = { signal: controller.signal, adapters: {
      "llmquant-data": { fetchBars: async () => [] },
      "financial-datasets": { fetchBars: async () => { controller.abort(new Error("cancelled")); return []; } },
      akshare: { fetchBars: publicBars },
    } };
    await expect(pullBarsFromProviders("AAPL", "US", undefined, undefined, "auto", providers)).rejects.toThrow("cancelled");
    expect(publicBars).not.toHaveBeenCalled();
  });

  it("honors the selected US provider and prevents cross-market fallback", async () => {
    const seen: string[] = [];
    const provider = (id: string, bars: Bar[]) => ({ fetchBars: async () => { seen.push(id); return bars; } });
    const providers: SourceProviderOptions = { adapters: {
      "financial-datasets": provider("fd", SAMPLE_BARS), "llmquant-data": provider("llm", SAMPLE_BARS),
      akshare: provider("ak", SAMPLE_BARS), tushare: provider("ts", SAMPLE_BARS),
    } };
    expect((await pullBarsFromProviders("AAPL", "US", undefined, undefined, "financial-datasets", providers)).source).toBe("financial-datasets");
    expect(seen).toEqual(["fd"]);
    seen.length = 0;
    await pullBarsFromProviders("600000", "A", undefined, undefined, "financial-datasets", providers);
    expect(seen).toEqual(["ak"]);
    seen.length = 0;
    await pullBarsFromProviders("00700.HK", "HK", undefined, undefined, "financial-datasets", providers);
    expect(seen).toEqual(["llm"]);
  });

  it("reuses fresh fallback cache and forwards range checks to storage", async () => {
    const fresh = mock(async (_symbol: string, source: string, _start?: string, _end?: string) => ({ bars: SAMPLE_BARS, fresh: source === "tushare" }));
    const result = await fetchBars("600000", "A", "2026-06-01", "2026-06-08", undefined, {
      deps: runtimeDeps({ loadCache: fresh }),
      providers: aShareProviders(async () => { throw new Error("must not run"); }, async () => []),
    });
    expect(result).toMatchObject({ origin: "cache", source: "tushare" });
    expect(fresh).toHaveBeenCalledWith("600000.SH", "tushare", "2026-06-01", "2026-06-08", undefined);
  });

  it("rejects invalid ranges before fetching and skips malformed bars", async () => {
    const provider = mock(async () => SAMPLE_BARS);
    const options = { providers: aShareProviders(provider, async () => []) };
    await expect(fetchBars("600000", "A", "2026-02-30", undefined, undefined, options)).rejects.toThrow("Dates must");
    await expect(fetchBars("600000", "A", "2026-09-13", "2026-09-01", undefined, options)).rejects.toThrow("Start date");
    expect(provider).not.toHaveBeenCalled();
    const result = await pullBarsFromProviders("600000", "A", undefined, undefined, "auto", aShareProviders(async () => [
      { ...SAMPLE_BARS[0]!, date: "2026-02-30" }, { ...SAMPLE_BARS[0]!, close: 0 },
      { ...SAMPLE_BARS[0]!, close: Number.NaN }, SAMPLE_BARS[1]!,
    ], async () => []));
    expect(result.bars).toEqual([SAMPLE_BARS[1]!]);
  });
});

it("cancellation during offline cache lookup prevents returning a cancelled result", async () => {
  const controller = new AbortController();
  let cacheSignal: AbortSignal | undefined;
  await expect(fetchBars("000001.SZ", "A", undefined, undefined, "akshare", {
    providers: aShareProviders(async () => [], async () => [], { signal: controller.signal }),
    deps: runtimeDeps({ loadCache: async (_symbol, _source, _start, _end, signal) => {
      cacheSignal = signal;
      controller.abort(new Error("Research cancelled"));
      return { bars: SAMPLE_BARS, fresh: false };
    } }),
  })).rejects.toThrow("Research cancelled");
  expect(cacheSignal).toBe(controller.signal);
});

it("cancellation stops provider fallback and prevents cache writes", async () => {
  const controller = new AbortController();
  const fallback = mock(async () => SAMPLE_BARS);
  const save = mock(async () => {});
  const providers = aShareProviders(async () => {
    controller.abort(new Error("Overview closed"));
    return SAMPLE_BARS;
  }, fallback, { signal: controller.signal });
  await expect(fetchBars("000001.SZ", "A", undefined, undefined, "auto", {
    providers, deps: runtimeDeps({ saveBars: save }),
  })).rejects.toThrow("Overview closed");
  expect(fallback).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

describe("whole source request deadline", () => {
  it("aborts asynchronous source preference and credential snapshots at the shared deadline", async () => {
    let preferenceSignal: AbortSignal | undefined;
    const preference = await fetchBars("000001.SZ", "A", undefined, undefined, "auto", {
      providers: aShareProviders(async () => SAMPLE_BARS, async () => [], { budgetMs: 10 }),
      deps: runtimeDeps({ getPreferredSource: (_market, signal) => {
        preferenceSignal = signal;
        return new Promise<"akshare">((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
      } }),
    });
    expect(preferenceSignal?.aborted).toBe(true);
    expect(preference).toMatchObject({ origin: "unavailable", budgetExhausted: true });

    let credentialSignal: AbortSignal | undefined;
    const pulled = await pullBarsFromProviders("000001.SZ", "A", undefined, undefined, "tushare", {
      budgetMs: 10, fallbackOrder: { A: ["tushare"] }, loadCredentials: signal => {
        credentialSignal = signal;
        return new Promise<never>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
      },
    });
    expect(credentialSignal?.aborted).toBe(true);
    expect(pulled).toMatchObject({ source: "unavailable", budgetExhausted: true,
      attempts: [{ source: "tushare", status: "error", error: "Provider request timed out" }] });
  });

  it("keeps non-A search independent of credentials and stops after slow A-share settings decode", async () => {
    let loads = 0;
    const transport = spyOn(globalThis, "fetch").mockImplementation((async (_input, _init) => Response.json({ code: 0, data: { fields: [], items: [] } })) as typeof fetch);
    try {
      const options: SourceProviderOptions = { budgetMs: 10, loadCredentials: () => {
        loads++;
        const until = performance.now() + 30;
        while (performance.now() < until) { /* Simulate synchronous settings decode. */ }
        return { tushare: { token: "local-test-token", baseUrl: "https://unit.test/tushare" } };
      } };
      expect(await searchSymbols("AAPL", "US", options)).toEqual([]);
      expect(loads).toBe(0);
      await expect(searchSymbols("000001", "A", options)).rejects.toThrow("timed out");
      expect(loads).toBe(1);
      expect(transport).not.toHaveBeenCalled();
    } finally { transport.mockRestore(); }
  });

  it("counts slow preferred-source selection before cache and provider dispatch", async () => {
    const cache = mock(async () => ({ bars: SAMPLE_BARS, fresh: true }));
    const provider = mock(async () => SAMPLE_BARS);
    const result = await fetchBars("000001.SZ", "A", undefined, undefined, "auto", {
      providers: aShareProviders(provider, async () => [], { budgetMs: 10 }),
      deps: runtimeDeps({ getPreferredSource: () => {
        const until = performance.now() + 30;
        while (performance.now() < until) { /* Simulate synchronous settings decode. */ }
        return "akshare";
      }, loadCache: cache }),
    });
    expect(result).toMatchObject({ origin: "unavailable", budgetExhausted: true, attempts: [] });
    expect(cache).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it("bounds a stuck cache lookup before dispatching any provider", async () => {
    const provider = mock(async () => SAMPLE_BARS);
    const started = performance.now();
    const result = await fetchBars("000001.SZ", "A", undefined, undefined, "auto", {
      providers: aShareProviders(provider, async () => [], { budgetMs: 25 }),
      deps: runtimeDeps({ loadCache: async () => new Promise(() => {}) }),
    });
    expect(performance.now() - started).toBeLessThan(500);
    expect(result).toMatchObject({ origin: "unavailable", source: "unavailable", bars: [], budgetExhausted: true, attempts: [] });
    expect(provider).not.toHaveBeenCalled();
  });

  it("marks a late synchronous cache response stale rather than claiming a timely fresh hit", async () => {
    const provider = mock(async () => SAMPLE_BARS);
    const result = await fetchBars("000001.SZ", "A", undefined, undefined, "auto", {
      providers: aShareProviders(provider, async () => [], { budgetMs: 10 }),
      deps: runtimeDeps({ loadCache: async () => {
        const until = performance.now() + 30;
        while (performance.now() < until) { /* Simulate synchronous JSON decode. */ }
        return { bars: SAMPLE_BARS, fresh: true };
      } }),
    });
    expect(result).toMatchObject({ origin: "stale-cache", source: "akshare", budgetExhausted: true });
    expect(provider).not.toHaveBeenCalled();
  });

  it("uses an already inspected stale response when the provider chain runs out of the same request budget", async () => {
    const cache = mock(async () => ({ bars: SAMPLE_BARS, fresh: false }));
    const fallback = mock(async () => SAMPLE_BARS);
    const result = await fetchBars("000001.SZ", "A", undefined, undefined, "auto", {
      providers: aShareProviders(async () => new Promise(() => {}), fallback, { budgetMs: 25 }),
      deps: runtimeDeps({ loadCache: cache }),
    });
    expect(result).toMatchObject({ origin: "stale-cache", source: "akshare", bars: SAMPLE_BARS, budgetExhausted: true });
    expect(fallback).not.toHaveBeenCalled();
    expect(cache).toHaveBeenCalledTimes(2); // Both compatible caches were inspected only once before providers.
  });

  it("prefers a compatible cache revision committed by another worker during failed provider attempts", async () => {
    let akshareReads = 0;
    const latest = SAMPLE_BARS.map(bar => ({ ...bar, close: bar.close + 2 }));
    const result = await fetchBars("000001.SZ", "A", undefined, undefined, "auto", {
      providers: aShareProviders(async () => [], async () => [], { budgetMs: 100 }),
      deps: runtimeDeps({ loadCache: async (_symbol, source) => source === "akshare"
        ? { bars: ++akshareReads === 1 ? SAMPLE_BARS : latest, fresh: false }
        : { bars: [], fresh: false } }),
    });
    expect(result).toMatchObject({ origin: "stale-cache", source: "akshare", bars: latest });
    expect(akshareReads).toBe(2);
  });

  it("does not return unarchived provider rows after a slow save exhausts the total deadline", async () => {
    const save = mock(async () => new Promise<void>(() => {}));
    const result = await fetchBars("000001.SZ", "A", undefined, undefined, "auto", {
      providers: aShareProviders(async () => SAMPLE_BARS, async () => [], { budgetMs: 25 }),
      deps: runtimeDeps({ saveBars: save }),
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ origin: "unavailable", source: "unavailable", bars: [], budgetExhausted: true });
    expect(result.attempts).toEqual([{ source: "akshare", status: "success" }]);
  });

  it("reports a completed immutable save when a custom synchronous dependency delays the budget timer", async () => {
    const dataset = { version: 1 as const, kind: "daily-bars" as const, symbol: "000001.SZ", market: "A" as const,
      source: "akshare", revision: "a".repeat(64), contentHash: "b".repeat(64), dates: SAMPLE_BARS.map(bar => bar.date),
      requested: { start: null, end: null }, snapshotAt: "2026-06-09T00:00:00.000Z",
      adjustment: "provider-unspecified" as const, availability: "observed-at-fetch" as const };
    const result = await fetchBars("000001.SZ", "A", undefined, undefined, "auto", {
      providers: aShareProviders(async () => SAMPLE_BARS, async () => [], { budgetMs: 10 }),
      deps: runtimeDeps({ saveBars: async () => {
        const until = performance.now() + 30;
        while (performance.now() < until) { /* A host-supplied synchronous dependency can still delay its own timer. */ }
        return dataset;
      } }),
    });
    expect(result).toMatchObject({ origin: "provider", source: "akshare", dataset, budgetExhausted: true });
  });

  it("shares one deadline across requested live rows and the latest-available retry", async () => {
    const calls: string[] = [];
    const provider = async (request: { start?: string }) => {
      calls.push(request.start ?? "latest");
      return request.start ? [] : new Promise<Bar[]>(() => {});
    };
    const started = performance.now();
    const result = await fetchLiveBars("000001.SZ", "A", "2030-01-01", "2030-01-31", {
      providers: aShareProviders(provider, async () => [], { budgetMs: 25 }),
    });
    expect(performance.now() - started).toBeLessThan(500);
    expect(result).toMatchObject({ bars: [], window: "unavailable", budgetExhausted: true });
    expect(calls).toEqual(["2030-01-01", "latest"]);
  });

  it("bounds symbol search and keeps user cancellation distinct", async () => {
    const controller = new AbortController();
    const server = Bun.serve({ port: 0, fetch: async () => new Promise<Response>(() => {}) });
    try {
      await expect(searchSymbols("AAPL", "A", { budgetMs: 25, tushare: { token: "test", baseUrl: `http://127.0.0.1:${server.port}` } }))
        .rejects.toThrow("timed out");
      controller.abort(new Error("search cancelled"));
      await expect(searchSymbols("AAPL", "A", { signal: controller.signal, budgetMs: 25 })).rejects.toThrow("search cancelled");
    } finally { server.stop(true); }
  });
});
