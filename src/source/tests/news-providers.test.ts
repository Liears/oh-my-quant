import { afterEach, expect, it } from "bun:test";
import { fetchEastmoneySubjectQuote, fetchNewsRows } from "../src/news-providers.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

it("posts the symbol-bound Yahoo ticker stream request and validates its schema", async () => {
  globalThis.fetch = (async (input, init) => {
    expect(String(input)).toBe("https://finance.yahoo.com/xhr/ncp?queryRef=latestNews&serviceKey=ncp_fin");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ serviceConfig: { snippetCount: 30, s: ["0700.HK"] } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return Response.json({ data: { tickerStream: { stream: [{ content: { id: "fixture" } }] } } });
  }) as typeof fetch;
  expect(await fetchNewsRows("yahoo", "0700.HK", undefined, "ticker-news")).toEqual([{ content: { id: "fixture" } }]);
  globalThis.fetch = (async (_input, _init) => Response.json({ data: { tickerStream: {} } })) as typeof fetch;
  await expect(fetchNewsRows("yahoo", "0700.HK", undefined, "ticker-news")).rejects.toThrow("Invalid Yahoo ticker");
  await expect(fetchNewsRows("eastmoney", "000001", undefined, "ticker-news")).rejects.toThrow("requires Yahoo");
});

it("constructs the Yahoo search request and passes the response rows and abort signal", async () => {
  let seen: URL | undefined, signal: AbortSignal | null | undefined;
  globalThis.fetch = (async (input, init) => {
    seen = new URL(String(input)); signal = init?.signal;
    return Response.json({ news: [{ uuid: "fixture" }], quotes: [{ symbol: "AAPL" }] });
  }) as typeof fetch;
  expect(await fetchNewsRows("yahoo", "BRK-B")).toEqual({ rows: [{ uuid: "fixture" }], quotes: [{ symbol: "AAPL" }] });
  expect(seen!.origin).toBe("https://query2.finance.yahoo.com"); expect(seen!.pathname).toBe("/v1/finance/search");
  expect(seen!.searchParams.get("q")).toBe("BRK-B"); expect(seen!.searchParams.get("newsCount")).toBe("30");
  expect(seen!.searchParams.get("enableFuzzyQuery")).toBe("false"); expect(signal).toBeInstanceOf(AbortSignal);
});

it("does not interpret a changed schema or a rate limit as an empty successful feed", async () => {
  globalThis.fetch = (async () => Response.json({ data: [] })) as unknown as typeof fetch;
  await expect(fetchNewsRows("yahoo", "AAPL")).rejects.toThrow("Invalid Yahoo");
  globalThis.fetch = (async () => new Response("Rate limit", { status: 429 })) as unknown as typeof fetch;
  await expect(fetchNewsRows("yahoo", "AAPL")).rejects.toThrow("HTTP 429");
});

it("fetches a bounded Eastmoney code/name quote and treats an outage as missing metadata", async () => {
  let seen: URL | undefined;
  globalThis.fetch = (async (input, init) => {
    seen = new URL(String(input));
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return Response.json({ data: { f57: "000001", f58: "平安银行" } });
  }) as typeof fetch;
  expect(await fetchEastmoneySubjectQuote("000001")).toEqual({ f57: "000001", f58: "平安银行" });
  expect(seen!.origin).toBe("https://push2.eastmoney.com");
  expect(seen!.searchParams.get("secid")).toBe("0.000001");
  expect(seen!.searchParams.get("fields")).toBe("f57,f58");
  expect(await fetchEastmoneySubjectQuote("830799")).toBeNull();
  globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
  expect(await fetchEastmoneySubjectQuote("000001")).toBeNull();
});
