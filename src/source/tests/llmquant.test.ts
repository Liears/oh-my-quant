import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { fetchFromLlmQuant } from "../src/llmquant.ts";
import { fetchBars } from "../src/sources.ts";

describe("llmquant adapter", () => {
  const originalKey = process.env.WHYJ_QUANT_LLMQUANT_API_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.WHYJ_QUANT_LLMQUANT_API_KEY = "llmq-test-key";
  });

  afterEach(() => {
    if (originalKey == null) delete process.env.WHYJ_QUANT_LLMQUANT_API_KEY;
    else process.env.WHYJ_QUANT_LLMQUANT_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  });

  it("maps wrapped equity historical rows and preserves adjClose", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        data: [
          {
            trade_date: "2026-06-18",
            open: 50,
            high: 52,
            low: 49.5,
            close: 51.2,
            volume: 7000,
            adj_close: 50.8,
          },
        ],
      }))
    ) as unknown as typeof fetch;

    const { fetchFromLlmQuant } = await import(`../src/llmquant.ts?case=bars-${Date.now()}`);
    const bars = await fetchFromLlmQuant("AAPL", "2026-06-01", "2026-06-18");
    expect(bars).toEqual([
      {
        date: "2026-06-18",
        open: 50,
        high: 52,
        low: 49.5,
        close: 51.2,
        volume: 7000,
        amount: null,
        adjClose: 50.8,
      },
    ]);
  });

  it("accepts an explicit API key without reading process env", async () => {
    delete process.env.WHYJ_QUANT_LLMQUANT_API_KEY;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer explicit-key");
      return new Response(JSON.stringify({ data: [{ trade_date: "2026-06-18", open: 50, high: 52,
        low: 49.5, close: 51.2, volume: 7000 }] }));
    }) as unknown as typeof fetch;

    const { fetchFromLlmQuant } = await import(`../src/llmquant.ts?case=explicit-${Date.now()}`);
    const rows = await fetchFromLlmQuant("AAPL", undefined, undefined, { apiKey: "explicit-key" });
    expect(rows[0]?.close).toBe(51.2);
  });

  it("rejects a wrapped historical series that declares another ticker", async () => {
    globalThis.fetch = (async () => Response.json({ data: { ticker: "MSFT", prices: [
      { time: "2026-06-18", open: 50, high: 52, low: 49.5, close: 51.2, volume: 7000 },
    ] } })) as unknown as typeof fetch;
    await expect(fetchFromLlmQuant("AAPL")).rejects.toThrow("Provider identity mismatch");
  });

  it("accepts matching declared ticker and requests the largest supported explicit window", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      expect(new URL(String(input)).searchParams.get("limit")).toBe("200");
      return Response.json({ data: { ticker: "AAPL", prices: [
        { time: "2026-06-18", open: 50, high: 52, low: 49.5, close: 51.2, volume: 7000 },
      ] } });
    }) as unknown as typeof fetch;
    const rows = await fetchFromLlmQuant("AAPL", "2026-06-18", "2026-06-18");
    expect(rows).toMatchObject([{ date: "2026-06-18", close: 51.2 }]);
  });

  it("rejects a mixed-ticker legacy array before returning bars", async () => {
    globalThis.fetch = (async () => Response.json({ data: [
      { ticker: "AAPL", time: "2026-06-17", open: 50, high: 52, low: 49.5, close: 51.2, volume: 7000 },
      { ticker: "MSFT", time: "2026-06-18", open: 60, high: 62, low: 59.5, close: 61.2, volume: 8000 },
    ] })) as unknown as typeof fetch;
    await expect(fetchFromLlmQuant("AAPL")).rejects.toThrow("Provider identity mismatch");
  });

  it("rejects a truncation notice when no smaller bounded window exists", async () => {
    globalThis.fetch = (async () => Response.json({ data: { ticker: "AAPL", prices: [
      { time: "2026-06-18", open: 50, high: 52, low: 49.5, close: 51.2, volume: 7000 },
    ] }, meta: { notice: "More data exists in the requested window than the items returned" } })) as unknown as typeof fetch;
    await expect(fetchFromLlmQuant("AAPL", "2026-06-18", "2026-06-18"))
      .rejects.toThrow("Provider response truncated");
    await expect(fetchFromLlmQuant("AAPL", "2026-01-01"))
      .rejects.toThrow("Provider response truncated");
  });

  it("splits a truncated bounded window and archives only its complete result", async () => {
    const requested: string[] = [];
    const row = (date: string, close: number) => ({ time: date, open: close, high: close + 1,
      low: close - 1, close, volume: 7000, adjusted_close: close });
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer llmq-test-key");
      const query = new URL(String(input)).searchParams;
      const range = `${query.get("start_date")}..${query.get("end_date")}`;
      requested.push(range);
      expect(query.get("limit")).toBe("200");
      return Response.json(range === "2026-06-01..2026-06-08"
        ? { data: { ticker: "AAPL", prices: [row("2026-06-08", 18)] },
          meta: { notice: "More data exists in the requested window" } }
        : { data: { ticker: "AAPL", prices: range === "2026-06-01..2026-06-04"
          ? [row("2026-06-02", 12), row("2026-06-03", 13)]
          : [row("2026-06-05", 15), row("2026-06-08", 18)] } });
    }) as unknown as typeof fetch;
    const saved: string[][] = [];
    const result = await fetchBars("AAPL", "US", "2026-06-01", "2026-06-08", "llmquant-data", {
      providers: { llmquant: { apiKey: "llmq-test-key" } },
      deps: {
        loadCache: async () => ({ bars: [], fresh: false }),
        saveBars: async (_symbol, _source, bars) => { saved.push(bars.map(bar => bar.date)); },
        getPreferredSource: () => "llmquant-data",
      },
    });
    expect(requested).toEqual(["2026-06-01..2026-06-08", "2026-06-01..2026-06-04", "2026-06-05..2026-06-08"]);
    expect(result).toMatchObject({ source: "llmquant-data", bars: [
      { date: "2026-06-02", close: 12 }, { date: "2026-06-03", close: 13 },
      { date: "2026-06-05", close: 15 }, { date: "2026-06-08", close: 18 },
    ] });
    expect(saved).toEqual([["2026-06-02", "2026-06-03", "2026-06-05", "2026-06-08"]]);
  });

  it("does not archive earlier slices when a later slice fails", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 3) return new Response("upstream failed", { status: 503 });
      return Response.json({ data: { ticker: "AAPL", prices: [
        { time: "2026-06-02", open: 50, high: 52, low: 49, close: 51, volume: 7000 },
      ] }, ...(calls === 1 ? { meta: { notice: "More data exists in the requested window" } } : {}) });
    }) as unknown as typeof fetch;
    const saved: string[] = [];
    const result = await fetchBars("AAPL", "US", "2026-06-01", "2026-06-08", "llmquant-data", {
      providers: { llmquant: { apiKey: "llmq-test-key" }, adapters: {
        "financial-datasets": { fetchBars: async () => [] },
        akshare: { fetchBars: async () => [{ date: "2026-06-08", open: 10, high: 11, low: 9, close: 10.5, volume: 100, amount: null }] },
      } },
      deps: {
        loadCache: async () => ({ bars: [], fresh: false }),
        saveBars: async (_symbol, source) => { saved.push(source); },
        getPreferredSource: () => "llmquant-data",
      },
    });
    expect(calls).toBe(3);
    expect(result).toMatchObject({ source: "akshare", attempts: [
      { source: "llmquant-data", status: "error", error: "HTTP 503" },
      { source: "financial-datasets", status: "empty" },
      { source: "akshare", status: "success" },
    ] });
    expect(saved).toEqual(["akshare"]);
  });

  it("rejects a child response that ignores its requested date boundary", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({ data: { ticker: "AAPL", prices: calls === 1 ? [] : [
        { time: "2026-06-08", open: 50, high: 52, low: 49, close: 51, volume: 7000 },
      ] }, ...(calls === 1 ? { meta: { notice: "More data exists in the requested window" } } : {}) });
    }) as unknown as typeof fetch;
    await expect(fetchFromLlmQuant("AAPL", "2026-06-01", "2026-06-08"))
      .rejects.toThrow("Provider response invalid");
    expect(calls).toBe(2);
  });

  it("cancels before dispatching the next child window", async () => {
    const controller = new AbortController();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 2) controller.abort();
      return Response.json({ data: { ticker: "AAPL", prices: [] },
        ...(calls === 1 ? { meta: { notice: "More data exists in the requested window" } } : {}) });
    }) as unknown as typeof fetch;
    await expect(fetchFromLlmQuant("AAPL", "2026-06-01", "2026-06-08", { signal: controller.signal }))
      .rejects.toBeDefined();
    expect(calls).toBe(2);
  });

  it("bounds the number of split requests before dispatch", async () => {
    let calls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls += 1;
      const query = new URL(String(input)).searchParams;
      const start = query.get("start_date"), end = query.get("end_date");
      return Response.json({ data: { ticker: "AAPL", prices: [] },
        ...(start !== end ? { meta: { notice: "More data exists in the requested window" } } : {}) });
    }) as unknown as typeof fetch;
    await expect(fetchFromLlmQuant("AAPL", "2026-01-01", "2027-12-31"))
      .rejects.toThrow("Provider response truncated");
    expect(calls).toBe(128);
  });

  it("rejects an incomplete row and archives only the compatible fallback", async () => {
    globalThis.fetch = (async () => Response.json({ data: { ticker: "AAPL", prices: [
      { time: "2026-06-17", open: 50, high: 52, low: 49.5, close: 51.2, volume: 7000 },
      { time: "2026-06-18", open: 51, high: 53, low: 50, close: 52, volume: null },
    ] } })) as unknown as typeof fetch;
    const saved: string[] = [];
    const result = await fetchBars("AAPL", "US", "2026-06-17", "2026-06-18", "llmquant-data", {
      providers: { llmquant: { apiKey: "llmq-test-key" }, adapters: {
        "financial-datasets": { fetchBars: async () => [] },
        akshare: { fetchBars: async () => [{ date: "2026-06-18", open: 10, high: 11, low: 9, close: 10.5, volume: 100, amount: null }] },
      } },
      deps: {
        loadCache: async () => ({ bars: [], fresh: false }),
        saveBars: async (_symbol, source) => { saved.push(source); },
        getPreferredSource: () => "llmquant-data",
      },
    });
    expect(result).toMatchObject({ source: "akshare", attempts: [
      { source: "llmquant-data", status: "error", error: "Provider response invalid" },
      { source: "financial-datasets", status: "empty" },
      { source: "akshare", status: "success" },
    ] });
    expect(saved).toEqual(["akshare"]);
  });

  it("rejects an invalid adjusted close or a malformed response envelope", async () => {
    globalThis.fetch = (async () => Response.json({ data: { ticker: "AAPL", prices: [
      { time: "2026-06-18", open: 50, high: 52, low: 49.5, close: 51.2, volume: 7000, adjusted_close: -1 },
    ] } })) as unknown as typeof fetch;
    await expect(fetchFromLlmQuant("AAPL")).rejects.toThrow("Provider response invalid");
    globalThis.fetch = (async () => Response.json({ data: { ticker: "AAPL", prices: {} } })) as unknown as typeof fetch;
    await expect(fetchFromLlmQuant("AAPL")).rejects.toThrow("Provider response invalid");
  });
});
