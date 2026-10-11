import { describe, expect, it } from "bun:test";
import { fetchNews, newsProviderQuery, normalizeNewsScope } from "../src/news.ts";
import type { NewsRequest } from "../../types/news.ts";

const request: NewsRequest = { symbol: "AAPL", market: "US", start: "2026-09-01", end: "2026-09-10" };
const now = () => new Date("2026-09-14T12:00:00Z");
function yahoo(extra: Record<string, unknown> = {}) {
  return { uuid: "story-1", title: "Apple raises guidance", publisher: "Fixture News", link: "https://example.com/story?utm_source=yahoo",
    providerPublishTime: Date.parse("2026-09-08T14:00:00Z") / 1000, relatedTickers: ["AAPL"], ...extra };
}

describe("news provider observations", () => {
  it.each([
    ["600000.SH", "A", "600000.SS", "600000.SH"], ["000001", "A", "000001.SZ", "000001.SZ"],
    ["0700.HK", "HK", "0700.HK", "00700.HK"], ["09988.HK", "HK", "9988.HK", "09988.HK"],
    ["BRK.B", "US", "BRK-B", "BRK.B"], ["aapl", "US", "AAPL", "AAPL"],
  ])("maps %s without changing exchange identity", async (symbol, market, query, canonical) => {
    const calls: string[] = [];
    const result = await fetchNews({ ...request, symbol, market: market as NewsRequest["market"], provider: "yahoo" }, { now,
      transport: async (_provider, value) => { calls.push(value); return [yahoo({ relatedTickers: [query] })]; } });
    expect(calls).toEqual([query]); expect(result.scope.symbol).toBe(canonical); expect(result.articles).toHaveLength(1);
  });

  it.each([
    ["600000.SH", "US"], ["AAPL", "A"], ["00700.HK", "A"], ["000300.SH", "A"], ["270042.OF", "A"],
  ])("rejects wrong-market/unsupported scope %s before transport", async (symbol, market) => {
    let calls = 0;
    await expect(fetchNews({ ...request, symbol, market: market as NewsRequest["market"] }, { transport: async () => { calls++; return []; } })).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("rejects invalid dates and unsupported provider before IO", async () => {
    await expect(fetchNews({ ...request, start: "2026-02-30" })).rejects.toThrow("Dates");
    await expect(fetchNews({ ...request, start: "2026-10-01" })).rejects.toThrow("Start");
    expect(newsProviderQuery(normalizeNewsScope({ ...request, symbol: "830799.BJ", market: "A" }), "yahoo")).toBeNull();
    const value = await fetchNews({ ...request, provider: "eastmoney" }, { now, transport: async () => { throw new Error("Must not call"); } });
    expect(value.status).toBe("unavailable"); expect(value.attempts[0]?.status).toBe("unsupported");
  });

  it("preserves original links and merges URL/title duplicates without double-counting syndication", async () => {
    const rows = [yahoo(), yahoo({ link: "https://example.com/story?utm_source=feed#top", uuid: "other" }),
      yahoo({ link: "https://another.example/story", publisher: "Syndicated Copy" })];
    const result = await fetchNews(request, { now, transport: async () => rows });
    expect(result.articles).toHaveLength(1); expect(result.articles[0]?.origins).toHaveLength(3);
    expect(result.articles[0]?.origins[0]?.url).toBe(rows[0]!.link);
    expect(result.attempts[0]?.excluded.duplicates).toBe(2);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await fetchNews(request, { now, transport: async () => rows })).contentHash).toBe(result.contentHash);
    expect(result.limitations.join(" ")).toContain("route labels, not calibrated or ordered evidence tiers");
  });

  it("keeps only an exact equity quote as a provider-claimed subject hint, including when news-search is empty", async () => {
    const result = await fetchNews(request, { now, transport: async () => ({ rows: [yahoo()], quotes: [
      { symbol: "AAPU", quoteType: "ETF", shortname: "Direxion Daily AAPL Bull" },
      { symbol: "AAPL", quoteType: "EQUITY", shortname: "Apple Inc.", longname: "Apple Inc." },
    ] }) });
    expect(result.subject).toEqual({ status: "provider-claimed", symbol: "AAPL", names: ["Apple Inc."], source: "yahoo-search-quote" });
    const missing = await fetchNews(request, { now, transport: async (_provider, _query, _signal, endpoint) => endpoint === "news-search"
      ? { rows: [], quotes: [{ symbol: "AAPL", quoteType: "EQUITY", shortname: "Apple Inc." }] } : [] });
    expect(missing.subject?.names).toEqual(["Apple Inc."]);
    const wrong = await fetchNews(request, { now, transport: async () => ({ rows: [yahoo()], quotes: [
      { symbol: "MSFT", quoteType: "EQUITY", shortname: "Microsoft" },
      { symbol: "AAPL", quoteType: "ETF", shortname: "Apple-looking ETF" },
    ] }) });
    expect(wrong.subject).toEqual({ status: "unavailable", symbol: "AAPL", names: [], source: null });
  });

  it("filters dates in the actual market timezone including US DST", async () => {
    const result = await fetchNews({ ...request, start: "2026-03-08", end: "2026-03-08" }, { now, transport: async () => [
      yahoo({ providerPublishTime: Date.parse("2026-03-09T03:59:00Z") / 1000 }),
      yahoo({ providerPublishTime: Date.parse("2026-03-09T04:01:00Z") / 1000 }),
    ] });
    expect(result.articles).toHaveLength(1); expect(result.articles[0]?.marketDate).toBe("2026-03-08");
    expect(result.attempts[0]?.excluded.afterWindow).toBe(1);
  });

  it("keeps changed claims at one URL separate and never hides a later publication behind an old duplicate", async () => {
    const result = await fetchNews(request, { now, transport: async () => [yahoo(),
      yahoo({ providerPublishTime: Date.parse("2026-09-10T14:00:00Z") / 1000 }),
      yahoo({ title: "Apple cuts guidance", providerPublishTime: Date.parse("2026-09-10T15:00:00Z") / 1000 })] });
    expect(result.articles).toHaveLength(2);
    const updated = result.articles.find(article => article.title === "Apple raises guidance")!;
    expect(updated.publishedAt).toBe("2026-09-10T14:00:00.000Z"); expect(updated.marketDate).toBe("2026-09-10");
    expect(updated.origins.map(origin => origin.publishedAt)).toEqual(["2026-09-08T14:00:00.000Z", "2026-09-10T14:00:00.000Z"]);
    expect(new Set(result.articles.map(article => article.id)).size).toBe(2);
  });

  it("rejects a future end date using the market day before any provider request", async () => {
    let calls = 0;
    await expect(fetchNews({ ...request, end: "2026-09-14" }, { now: () => new Date("2026-09-14T01:00:00Z"),
      transport: async () => { calls++; return []; } })).rejects.toThrow("future");
    expect(calls).toBe(0);
  });

  it("normalizes Eastmoney timestamps as Shanghai local and keeps keyword relevance uncertain", async () => {
    const result = await fetchNews({ ...request, symbol: "000001.SZ", market: "A", provider: "eastmoney", start: "2026-09-08", end: "2026-09-08" }, { now,
      transport: async () => [{ "关键词": "000001", "新闻标题": "<em>平安银行</em>净利润增长", "文章来源": "Fixture", "新闻链接": "https://example.com/cn", "发布时间": "2026-09-08 00:30:00" }] });
    expect(result.articles[0]).toMatchObject({ title: "平安银行净利润增长", publishedAt: "2026-09-07T16:30:00.000Z", marketDate: "2026-09-08", relevance: "search-match" });
    expect(result.limitations.join(" ")).toContain("route labels, not calibrated or ordered evidence tiers");
  });

  it("uses an exact Eastmoney code/name quote for A-share titles, without losing news on bad metadata", async () => {
    const input = { ...request, symbol: "000001.SZ", market: "A" as const, provider: "auto" as const };
    const row = { "关键词": "000001", "新闻标题": "平安银行净利润增长", "文章来源": "Fixture",
      "新闻链接": "https://example.com/cn", "发布时间": "2026-09-08 10:30:00" };
    const result = await fetchNews(input, { now, transport: async (provider) => provider === "eastmoney"
      ? { rows: [row], quote: { f57: "000001", f58: "平安银行" } }
      : { rows: [], quotes: [{ symbol: "000001.SZ", quoteType: "EQUITY", shortname: "PAB" }] } });
    expect(result.articles).toHaveLength(1);
    expect(result.subject).toEqual({ status: "provider-claimed", symbol: "000001.SZ", names: ["平安银行"], source: "eastmoney-stock-quote" });

    const wrong = await fetchNews({ ...input, provider: "eastmoney" }, { now,
      transport: async () => ({ rows: [row], quote: { f57: "000002", f58: "万科Ａ" } }) });
    expect(wrong.articles).toHaveLength(1);
    expect(wrong.subject?.status).toBe("unavailable");
    let calls = 0;
    await expect(fetchNews({ ...input, symbol: "600519.SZ", provider: "eastmoney" }, { now,
      transport: async () => { calls++; return { rows: [row], quote: { f57: "600519", f58: "贵州茅台" } }; } })).rejects.toThrow("exchange");
    expect(calls).toBe(0);
  });

  it("excludes missing attribution, unsafe links, unrelated, old and future news without scores", async () => {
    const result = await fetchNews(request, { now, transport: async () => [yahoo({ publisher: "" }), yahoo({ link: "javascript:alert(1)" }),
      yahoo({ link: "https://secret@example.com" }), yahoo({ relatedTickers: ["MSFT"] }),
      yahoo({ providerPublishTime: Date.parse("2026-08-01T12:00:00Z") / 1000 }),
      yahoo({ providerPublishTime: Date.parse("2026-09-15T12:00:00Z") / 1000 })] });
    expect(result.articles).toEqual([]); expect(result.status).toBe("outside-window");
    expect(result.attempts[0]?.excluded).toEqual({ invalid: 3, unrelated: 1, beforeWindow: 1, afterWindow: 0, future: 1, duplicates: 0 });
  });

  it("retains supplier failure while the other supplier succeeds", async () => {
    const result = await fetchNews({ ...request, symbol: "000001.SZ", market: "A" }, { now, transport: async (provider) => {
      if (provider === "eastmoney") throw new Error("private-path/token=fixture-secret");
      return [yahoo({ relatedTickers: ["000001.SZ"] })];
    } });
    expect(result.status).toBe("available"); expect(result.attempts.map(attempt => attempt.status)).toEqual(["error", "success"]);
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
  });

  it("distinguishes empty from total failure and rejects malformed responses", async () => {
    expect((await fetchNews(request, { now, transport: async () => [] })).status).toBe("empty");
    expect((await fetchNews(request, { now, transport: async () => ({ news: [] }) })).status).toBe("unavailable");
  });

  it("bounds retained articles and reports omissions", async () => {
    const result = await fetchNews(request, { now, transport: async () => Array.from({ length: 40 }, (_, index) => yahoo({ title: `Apple story ${index}`, link: `https://example.com/${index}` })) });
    expect(result.articles).toHaveLength(30); expect(result.omittedArticles).toBe(10); expect(result.attempts[0]?.accepted).toBe(40);
  });

  it("cancels before IO and after an uncooperative provider without trying another provider", async () => {
    const controller = new AbortController(); let calls = 0;
    const pending = fetchNews({ ...request, symbol: "000001.SZ", market: "A" }, { signal: controller.signal,
      transport: async () => { calls++; controller.abort(new Error("cancelled")); return []; } });
    await expect(pending).rejects.toThrow("cancelled"); expect(calls).toBe(1);
    await expect(fetchNews(request, { signal: controller.signal, transport: async () => { calls++; return []; } })).rejects.toThrow("cancelled");
    expect(calls).toBe(1);
  });
});
