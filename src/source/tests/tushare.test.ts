import { fetchFromTushare, fetchFromTushareDetailed, fetchTushareSnapshot } from "../src/tushare.ts";
import { fetchBars } from "../src/sources.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

describe("tushare adapter", () => {
  const originalToken = process.env.WHYJ_QUANT_TUSHARE_TOKEN;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.WHYJ_QUANT_TUSHARE_TOKEN = "test-token";
  });

  afterEach(() => {
    if (originalToken == null) delete process.env.WHYJ_QUANT_TUSHARE_TOKEN;
    else process.env.WHYJ_QUANT_TUSHARE_TOKEN = originalToken;
    globalThis.fetch = originalFetch;
  });

  it("maps daily rows into Bar objects", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        code: 0,
        data: {
          fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"],
          items: [
            ["000001.SZ", "20260618", 10.1, 10.6, 10, 10.4, 12345, 67890],
          ],
        },
      }))
    ) as unknown as typeof fetch;

    const { fetchFromTushare } = await import(`../src/tushare.ts?case=daily-${Date.now()}`);
    const bars = await fetchFromTushare("000001.SZ", "2026-06-01", "2026-06-18");
    expect(bars).toEqual([
      {
        date: "2026-06-18",
        open: 10.1,
        high: 10.6,
        low: 10,
        close: 10.4,
        volume: 12345,
        amount: 67890,
      },
    ]);
  });

  it("preserves a missing daily turnover rather than fabricating zero", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ code: 0, data: {
      fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"],
      items: [["000001.SZ", "20260618", 10, 11, 9, 10.5, 100, null]],
    } }))) as unknown as typeof fetch;
    const bars = await fetchFromTushare("000001.SZ", "2026-06-18", "2026-06-18");
    expect(bars[0]?.amount).toBeNull();
    expect(bars[0]?.close).toBe(10.5);
  });

  it("maps stock_basic rows into SymbolInfo objects", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        code: 0,
        data: {
          fields: ["ts_code", "name", "area", "industry", "market", "list_date"],
          items: [
            ["600000.SH", "浦发银行", "上海", "银行", "主板", "19991110"],
          ],
        },
      }))
    ) as unknown as typeof fetch;

    const { searchTushareSymbols } = await import(`../src/tushare.ts?case=search-${Date.now()}`);
    const rows = await searchTushareSymbols("浦发");
    expect(rows).toEqual([
      {
        code: "600000.SH",
        name: "浦发银行",
        market: "A",
        exchange: "SSE",
        type: "stock",
        listDate: "19991110",
      },
    ]);
  });

  it("routes exchange-traded funds directly to fund_daily", async () => {
    let callCount = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      callCount++;
      const body = JSON.parse(
        typeof (init?.body) === "string" ? init.body : "{}",
      );
      // ETF must use the fund endpoint on its first request.
      if (body.api_name !== "fund_daily") {
        return new Response(JSON.stringify({ code: 0, data: { fields: [], items: [] } }));
      }
      return new Response(JSON.stringify({
        code: 0,
        data: {
          fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"],
          items: [
            ["510050.SH", "20260618", 2.5, 2.6, 2.4, 2.55, 500000, 1275000],
          ],
        },
      }));
    }) as unknown as typeof fetch;

    const { fetchFromTushare } = await import(`../src/tushare.ts?case=fund-${Date.now()}`);
    const bars = await fetchFromTushare("510050.SH", "2026-06-01", "2026-06-18");
    expect(callCount).toBe(1);
    expect(bars).toEqual([
      {
        date: "2026-06-18",
        open: 2.5,
        high: 2.6,
        low: 2.4,
        close: 2.55,
        volume: 500000,
        amount: 1275000,
      },
    ]);
  });

  it("returns the first daily_basic snapshot row", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        code: 0,
        data: {
          fields: ["ts_code", "trade_date", "close", "pe", "pe_ttm", "pb", "total_mv", "circ_mv"],
          items: [
            ["000001.SZ", "20260618", 12.3, 8.1, 8.4, 1.2, 1000000, 900000],
          ],
        },
      }))
    ) as unknown as typeof fetch;

    const { fetchTushareSnapshot } = await import(`../src/tushare.ts?case=snapshot-${Date.now()}`);
    const snapshot = await fetchTushareSnapshot("000001.SZ");
    expect(snapshot).toEqual({
      ts_code: "000001.SZ",
      trade_date: "20260618",
      close: 12.3,
      pe: 8.1,
      pe_ttm: 8.4,
      pb: 1.2,
      total_mv: 1000000,
      circ_mv: 900000,
    });
  });

  it("rejects a mixed-symbol daily response before using any row", async () => {
    globalThis.fetch = (async () => Response.json({ code: 0, data: {
      fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"],
      items: [
        ["000001.SZ", "20260617", 10, 11, 9, 10.5, 100, 1000],
        ["600000.SH", "20260618", 20, 21, 19, 20.5, 200, 2000],
      ],
    } })) as unknown as typeof fetch;
    await expect(fetchFromTushare("000001.SZ")).rejects.toThrow("Tushare response identity mismatch");
  });

  it("rejects an index response without a code field", async () => {
    globalThis.fetch = (async () => Response.json({ code: 0, data: {
      fields: ["trade_date", "open", "high", "low", "close", "vol", "amount"],
      items: [["20260618", 10, 11, 9, 10.5, 100, 1000]],
    } })) as unknown as typeof fetch;
    await expect(fetchFromTushare("000001.SH")).rejects.toThrow("Tushare response identity mismatch");
  });

  it("requests and verifies fund_nav identity", async () => {
    let requestedFields = "";
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requestedFields = body.fields;
      expect(body.api_name).toBe("fund_nav");
      return Response.json({ code: 0, data: {
        fields: ["ts_code", "nav_date", "unit_nav", "adj_nav"],
        items: [["000002.OF", "20260618", 1.2, 1.8]],
      } });
    }) as unknown as typeof fetch;
    await expect(fetchFromTushare("000001.OF")).rejects.toThrow("Tushare response identity mismatch");
    expect(requestedFields).toBe("ts_code,nav_date,unit_nav,adj_nav");
  });

  it("rejects a daily_basic snapshot with a later row for another symbol", async () => {
    globalThis.fetch = (async () => Response.json({ code: 0, data: {
      fields: ["ts_code", "trade_date", "close"],
      items: [["000001.SZ", "20260618", 10.5], ["600000.SH", "20260617", 12.3]],
    } })) as unknown as typeof fetch;
    await expect(fetchTushareSnapshot("000001.SZ")).rejects.toThrow("Tushare response identity mismatch");
  });

  it("falls back without saving a wrong-symbol Tushare response", async () => {
    globalThis.fetch = (async () => Response.json({ code: 0, data: {
      fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"],
      items: [["600000.SH", "20260618", 20, 21, 19, 20.5, 200, 2000]],
    } })) as unknown as typeof fetch;
    const saved: string[] = [];
    const result = await fetchBars("000001.SZ", "A", "2026-06-18", "2026-06-18", "tushare", {
      providers: {
        tushare: { token: "test-token" },
        adapters: { akshare: { fetchBars: async () => [{
          date: "2026-06-18", open: 10, high: 11, low: 9, close: 10.5, volume: 100, amount: 1000,
        }] } },
      },
      deps: {
        loadCache: async () => ({ bars: [], fresh: false }),
        saveBars: async (_symbol, source) => { saved.push(source); },
        getPreferredSource: () => "tushare",
      },
    });
    expect(result).toMatchObject({ source: "akshare", origin: "provider", bars: [{ close: 10.5 }],
      attempts: [
        { source: "tushare", status: "error", error: "Provider identity mismatch" },
        { source: "akshare", status: "success" },
      ] });
    expect(saved).toEqual(["akshare"]);
  });

  it("accepts an explicit token without reading process env", async () => {
    delete process.env.WHYJ_QUANT_TUSHARE_TOKEN;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      expect(body.token).toBe("explicit-token");
      return new Response(JSON.stringify({
        code: 0,
        data: {
          fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"],
          items: [["000001.SZ", "20260618", 10, 11, 9, 10.5, 100, 1000]],
        },
      }));
    }) as unknown as typeof fetch;

    const { fetchFromTushare } = await import(`../src/tushare.ts?case=explicit-${Date.now()}`);
    const rows = await fetchFromTushare("000001.SZ", undefined, undefined, { token: "explicit-token" });
    expect(rows[0]?.close).toBe(10.5);
  });
  it("keeps stock, index and open-fund routes separate for the same numeric code", async () => {
    const endpoints: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      endpoints.push(body.api_name);
      return Response.json({ code: 0, data: body.api_name === "fund_nav"
        ? { fields: ["ts_code", "nav_date", "unit_nav", "adj_nav"], items: [["000001.OF", "20260618", 1.2, 1.8]] }
        : { fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"],
          items: [[body.params.ts_code, "20260618", 1, 1, 1, 1, 0, 0]] } });
    }) as typeof fetch;
    const stock = await fetchFromTushareDetailed("000001.SZ");
    const index = await fetchFromTushareDetailed("000001.SH");
    const nav = await fetchFromTushareDetailed("000001.OF");
    expect(endpoints).toEqual(["daily", "index_daily", "fund_nav"]);
    expect(stock).toMatchObject({ endpoint: "daily", adjustment: "unadjusted" });
    expect(index).toMatchObject({ endpoint: "index_daily", adjustment: "index-level" });
    expect(nav).toMatchObject({ endpoint: "fund_nav", adjustment: "unit-nav" });
    expect(nav.bars[0]).toMatchObject({ date: "2026-06-18", close: 1.2, volume: 0, adjClose: 1.8 });
  });

});
