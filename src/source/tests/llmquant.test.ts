import { afterEach, beforeEach, describe, expect, it } from "bun:test";

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
        amount: 0,
        adjClose: 50.8,
      },
    ]);
  });

  it("accepts an explicit API key without reading process env", async () => {
    delete process.env.WHYJ_QUANT_LLMQUANT_API_KEY;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer explicit-key");
      return new Response(JSON.stringify({ data: [{ trade_date: "2026-06-18", close: 51.2 }] }));
    }) as unknown as typeof fetch;

    const { fetchFromLlmQuant } = await import(`../src/llmquant.ts?case=explicit-${Date.now()}`);
    const rows = await fetchFromLlmQuant("AAPL", undefined, undefined, { apiKey: "explicit-key" });
    expect(rows[0]?.close).toBe(51.2);
  });
});
