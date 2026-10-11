import { fetchFinancialDatasetsSnapshot, fetchFromFinancialDatasets } from "../src/financial-datasets.ts";
import { fetchBars } from "../src/sources.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

describe("financial datasets adapter", () => {
  const originalKey = process.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = "fd-test-key";
  });

  afterEach(() => {
    if (originalKey == null) delete process.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY;
    else process.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = originalKey;
    globalThis.fetch = originalFetch;
  });

  it("maps stock price rows from wrapped payload", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        prices: [
          { date: "2026-06-18", open: 100, high: 103, low: 99, close: 102, volume: 5000 },
        ],
      }))
    ) as unknown as typeof fetch;

    const { fetchFromFinancialDatasets } = await import(`../src/financial-datasets.ts?case=bars-${Date.now()}`);
    const bars = await fetchFromFinancialDatasets("AAPL", "2026-06-01", "2026-06-18");
    expect(bars).toEqual([
      {
        date: "2026-06-18",
        open: 100,
        high: 103,
        low: 99,
        close: 102,
        volume: 5000,
        amount: null,
      },
    ]);
  });

  it("fetches the real-time price snapshot", async () => {
    let callCount = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      callCount += 1;
      const text = String(url);
      expect(text).toContain("/prices/snapshot");
      return new Response(JSON.stringify({ snapshot: { price: 182.9, open: 181, high: 183.5, low: 180.2, close: 182.9 } }));
    }) as unknown as typeof fetch;

    const { fetchFinancialDatasetsSnapshot } = await import(`../src/financial-datasets.ts?case=snapshot-${Date.now()}`);
    const snapshot = await fetchFinancialDatasetsSnapshot("AAPL");
    expect(callCount).toBe(1);
    expect(snapshot).toEqual({
      price: 182.9,
      open: 181,
      high: 183.5,
      low: 180.2,
      close: 182.9,
    });
  });

  it("accepts an explicit API key without reading process env", async () => {
    delete process.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["X-API-KEY"]).toBe("explicit-fd-key");
      return new Response(JSON.stringify({ prices: [{ date: "2026-06-18", open: 100, high: 103, low: 99, close: 102, volume: 5000 }] }));
    }) as unknown as typeof fetch;

    const { fetchFromFinancialDatasets } = await import(`../src/financial-datasets.ts?case=explicit-${Date.now()}`);
    const rows = await fetchFromFinancialDatasets("AAPL", undefined, undefined, { apiKey: "explicit-fd-key" });
    expect(rows[0]?.close).toBe(102);
  });
  it("anchors an end-only historical query to that end date", async () => {
    globalThis.fetch = (async input => {
      const query = new URL(String(input)).searchParams;
      expect(query.get("end_date")).toBe("2020-03-01");
      expect(query.get("start_date")).toBe("2020-01-01");
      return new Response(JSON.stringify({ prices: [] }));
    }) as typeof fetch;
    await fetchFromFinancialDatasets("AAPL", undefined, "2020-03-01");
  });

  it("takes the latest 30 bars even when the provider returns descending dates", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ prices:
      Array.from({ length: 40 }, (_, i) => ({
        date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString(),
        open: 10, high: 11, low: 9, close: 10, volume: 100,
      })).reverse(),
    }))) as unknown as typeof fetch;
    const bars = await fetchFromFinancialDatasets("AAPL");
    expect(bars).toHaveLength(30);
    expect(bars[0]?.date).toBe("2026-06-11");
    expect(bars.at(-1)?.date).toBe("2026-07-10");
  });

  it("rejects a response envelope for another ticker", async () => {
    globalThis.fetch = (async () => Response.json({ ticker: "MSFT", prices: [
      { ticker: "AAPL", time: "2026-06-18", open: 100, high: 103, low: 99, close: 102, volume: 5000 },
    ] })) as unknown as typeof fetch;
    await expect(fetchFromFinancialDatasets("AAPL")).rejects.toThrow("Provider identity mismatch");
  });

  it("accepts matching declared tickers in the envelope and rows", async () => {
    globalThis.fetch = (async () => Response.json({ ticker: "AAPL", prices: [
      { ticker: "AAPL", time: "2026-06-18", open: 100, high: 103, low: 99, close: 102, volume: 5000 },
    ] })) as unknown as typeof fetch;
    const rows = await fetchFromFinancialDatasets("AAPL", "2026-06-18", "2026-06-18");
    expect(rows).toMatchObject([{ date: "2026-06-18", close: 102 }]);
  });

  it("rejects a mixed-ticker price list even when its envelope matches", async () => {
    globalThis.fetch = (async () => Response.json({ ticker: "AAPL", prices: [
      { ticker: "AAPL", time: "2026-06-17", open: 100, high: 103, low: 99, close: 102, volume: 5000 },
      { ticker: "MSFT", time: "2026-06-18", open: 200, high: 203, low: 199, close: 202, volume: 6000 },
    ] })) as unknown as typeof fetch;
    await expect(fetchFromFinancialDatasets("AAPL")).rejects.toThrow("Provider identity mismatch");
  });

  it("rejects a snapshot that declares another ticker", async () => {
    globalThis.fetch = (async () => Response.json({ snapshot: { ticker: "MSFT", price: 182.9 } })) as unknown as typeof fetch;
    await expect(fetchFinancialDatasetsSnapshot("AAPL")).rejects.toThrow("Provider identity mismatch");
  });

  it("follows opaque cursors and archives the complete price window", async () => {
    const requested: string[] = [];
    const continuation = "https://api.financialdatasets.ai/prices/?cursor=opaque%2Ftoken";
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requested.push(String(input));
      expect((init?.headers as Record<string, string>)["X-API-KEY"]).toBe("fd-test-key");
      expect(init?.redirect).toBe("error");
      return Response.json(requested.length === 1
        ? { ticker: "AAPL", next_page_url: continuation, prices: [
          { ticker: "AAPL", time: "2026-06-18", open: 100, high: 103, low: 99, close: 102, volume: 5000 },
        ] }
        : { ticker: "AAPL", next_page_url: null, prices: [
          { ticker: "AAPL", time: "2026-06-17", open: 98, high: 100, low: 97, close: 99, volume: 4000 },
        ] });
    }) as unknown as typeof fetch;
    const saved: { source: string; dates: string[] }[] = [];
    const result = await fetchBars("AAPL", "US", "2026-06-17", "2026-06-18", "financial-datasets", {
      providers: { financialDatasets: { apiKey: "fd-test-key" } },
      deps: {
        loadCache: async () => ({ bars: [], fresh: false }),
        saveBars: async (_symbol, source, bars) => { saved.push({ source, dates: bars.map(bar => bar.date) }); },
        getPreferredSource: () => "financial-datasets",
      },
    });
    expect(requested).toHaveLength(2);
    expect(requested[1]).toBe(continuation);
    expect(result).toMatchObject({ source: "financial-datasets", bars: [
      { date: "2026-06-17", close: 99 }, { date: "2026-06-18", close: 102 },
    ] });
    expect(saved).toEqual([{ source: "financial-datasets", dates: ["2026-06-17", "2026-06-18"] }]);
  });

  it("does not forward the key to a cross-origin cursor or archive a partial page", async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return Response.json({ ticker: "AAPL", next_page_url: "https://attacker.example/prices/?cursor=next", prices: [
      { ticker: "AAPL", time: "2026-06-18", open: 100, high: 103, low: 99, close: 102, volume: 5000 },
      ] });
    }) as unknown as typeof fetch;
    const saved: string[] = [];
    const result = await fetchBars("AAPL", "US", "2026-06-18", "2026-06-18", "financial-datasets", {
      providers: {
        financialDatasets: { apiKey: "fd-test-key" },
        adapters: {
          "llmquant-data": { fetchBars: async () => [] },
          akshare: { fetchBars: async () => [{ date: "2026-06-18", open: 10, high: 11, low: 9, close: 10.5, volume: 100, amount: null }] },
        },
      },
      deps: {
        loadCache: async () => ({ bars: [], fresh: false }),
        saveBars: async (_symbol, source) => { saved.push(source); },
        getPreferredSource: () => "financial-datasets",
      },
    });
    expect(result).toMatchObject({ source: "akshare", origin: "provider", bars: [{ close: 10.5 }], attempts: [
      { source: "financial-datasets", status: "error", error: "Provider pagination invalid" },
      { source: "llmquant-data", status: "empty" },
      { source: "akshare", status: "success" },
    ] });
    expect(requests).toBe(1);
    expect(saved).toEqual(["akshare"]);
  });

  it("rejects a cursor cycle without dispatching it again", async () => {
    let requests = 0;
    const continuation = "https://api.financialdatasets.ai/prices/?cursor=repeat";
    globalThis.fetch = (async () => {
      requests += 1;
      return Response.json({ ticker: "AAPL", next_page_url: continuation, prices: [
        { ticker: "AAPL", time: "2026-06-18", open: 100, high: 103, low: 99, close: 102, volume: 5000 },
      ] });
    }) as unknown as typeof fetch;
    await expect(fetchFromFinancialDatasets("AAPL", "2026-06-01", "2026-06-18"))
      .rejects.toThrow("Provider pagination invalid");
    expect(requests).toBe(2);
  });

  it("rejects the whole window when a later page declares another ticker", async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return Response.json({ ticker: requests === 1 ? "AAPL" : "MSFT",
        next_page_url: requests === 1 ? "https://api.financialdatasets.ai/prices/?cursor=next" : null,
        prices: [{ ticker: requests === 1 ? "AAPL" : "MSFT", time: "2026-06-18",
          open: 100, high: 103, low: 99, close: 102, volume: 5000 }],
      });
    }) as unknown as typeof fetch;
    await expect(fetchFromFinancialDatasets("AAPL", "2026-06-01", "2026-06-18"))
      .rejects.toThrow("Provider identity mismatch");
    expect(requests).toBe(2);
  });

  it("rejects a malformed later page instead of returning the first page", async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return Response.json(requests === 1
        ? { prices: [{ date: "2026-06-18", open: 100, high: 103, low: 99, close: 102, volume: 5000 }],
          next_page_url: "https://api.financialdatasets.ai/prices/?cursor=next" }
        : { prices: { error: "malformed" } });
    }) as unknown as typeof fetch;
    await expect(fetchFromFinancialDatasets("AAPL", "2026-06-01", "2026-06-18"))
      .rejects.toThrow("Provider response invalid");
    expect(requests).toBe(2);
  });

  it("does not archive a complete-looking window with a missing volume on its later page", async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return Response.json(requests === 1
        ? { prices: [{ date: "2026-06-17", open: 100, high: 103, low: 99, close: 102, volume: 5000 }],
          next_page_url: "https://api.financialdatasets.ai/prices/?cursor=next" }
        : { prices: [{ date: "2026-06-18", open: 101, high: 104, low: 100, close: 103, volume: null }] });
    }) as unknown as typeof fetch;
    const saved: string[] = [];
    const result = await fetchBars("AAPL", "US", "2026-06-17", "2026-06-18", "financial-datasets", {
      providers: { financialDatasets: { apiKey: "fd-test-key" }, adapters: {
        "llmquant-data": { fetchBars: async () => [] },
        akshare: { fetchBars: async () => [{ date: "2026-06-18", open: 10, high: 11, low: 9, close: 10.5, volume: 100, amount: null }] },
      } },
      deps: {
        loadCache: async () => ({ bars: [], fresh: false }),
        saveBars: async (_symbol, source) => { saved.push(source); },
        getPreferredSource: () => "financial-datasets",
      },
    });
    expect(requests).toBe(2);
    expect(result).toMatchObject({ source: "akshare", attempts: [
      { source: "financial-datasets", status: "error", error: "Provider response invalid" },
      { source: "llmquant-data", status: "empty" },
      { source: "akshare", status: "success" },
    ] });
    expect(saved).toEqual(["akshare"]);
  });

  it("rejects an inconsistent OHLC row instead of dropping that trading date", async () => {
    globalThis.fetch = (async () => Response.json({ prices: [
      { date: "2026-06-17", open: 100, high: 103, low: 99, close: 102, volume: 5000 },
      { date: "2026-06-18", open: 101, high: 100, low: 102, close: 103, volume: 4000 },
    ] })) as unknown as typeof fetch;
    await expect(fetchFromFinancialDatasets("AAPL", "2026-06-17", "2026-06-18"))
      .rejects.toThrow("Provider response invalid");
  });

  it("enforces the page ceiling before another metered request", async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return Response.json({ prices: [], next_page_url: `https://api.financialdatasets.ai/prices/?cursor=page-${requests}` });
    }) as unknown as typeof fetch;
    await expect(fetchFromFinancialDatasets("AAPL", "2026-01-01", "2026-06-18"))
      .rejects.toThrow("Provider response truncated");
    expect(requests).toBe(128);
  });

  it("stops before the next page when the caller cancels", async () => {
    const controller = new AbortController();
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      controller.abort();
      return Response.json({ next_page_url: "https://api.financialdatasets.ai/prices/?cursor=next", prices: [
        { date: "2026-06-18", open: 100, high: 103, low: 99, close: 102, volume: 5000 },
      ] });
    }) as unknown as typeof fetch;
    await expect(fetchFromFinancialDatasets("AAPL", "2026-06-01", "2026-06-18", { signal: controller.signal }))
      .rejects.toBeDefined();
    expect(requests).toBe(1);
  });

});
