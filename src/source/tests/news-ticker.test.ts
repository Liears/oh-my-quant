import { expect, it } from "bun:test";
import { fetchNews } from "../src/news.ts";
import type { NewsEndpoint, NewsRequest } from "../../types/news.ts";

const request: NewsRequest = { symbol: "00700.HK", market: "HK", provider: "yahoo", start: "2026-09-01", end: "2026-09-14" };
const now = () => new Date("2026-09-14T12:00:00Z");
const story = { id: "fixture", contentType: "STORY", title: "Tencent raises guidance", pubDate: "2026-09-11T18:14:34Z",
  provider: { displayName: "Fixture News" }, canonicalUrl: { url: "https://finance.yahoo.com/news/fixture.html" } };

it("falls back from unrelated search to a symbol-bound feed without inventing an exact ticker tag", async () => {
  const calls: unknown[] = [];
  const result = await fetchNews(request, { now, transport: async (provider, query, _signal, endpoint) => {
    calls.push([provider, query, endpoint]);
    return endpoint === "news-search" ? [{ title: "Unrelated", publisher: "Fixture", link: "https://example.com/", relatedTickers: ["AAPL"], providerPublishTime: 1789150474 }]
      : [{ ad: [], content: story }];
  } });
  expect(calls).toEqual([["yahoo", "0700.HK", "news-search"], ["yahoo", "0700.HK", "ticker-news"]]);
  expect(result.status).toBe("available"); expect(result.attempts[0]!.excluded.unrelated).toBe(1);
  expect(result.articles[0]).toMatchObject({ relevance: "ticker-feed", marketDate: "2026-09-12", publishedAt: "2026-09-11T18:14:34.000Z",
    origins: [{ endpoint: "ticker-news", providerId: "fixture" }] });
});

it("skips ticker requests after an exact-tag match", async () => {
  const calls: unknown[] = [];
  await fetchNews(request, { now, transport: async (_provider, _query, _signal, endpoint) => {
    calls.push(endpoint); return [{ title: story.title, publisher: "Fixture", link: story.canonicalUrl.url, relatedTickers: ["0700.HK"], providerPublishTime: Date.parse(story.pubDate) / 1000 }];
  } });
  expect(calls).toEqual(["news-search"]);
});

it.each(["news-search", "ticker-news"] as const)("keeps a %s probe to exactly one endpoint", async endpoint => {
  const calls: (NewsEndpoint | undefined)[] = [];
  await fetchNews(request, { now, endpoint, transport: async (_provider, _query, _signal, route) => { calls.push(route); return []; } });
  expect(calls).toEqual([endpoint]);
  await expect(fetchNews({ ...request, provider: "auto" }, { now, endpoint })).rejects.toThrow("explicit matching");
  await expect(fetchNews({ ...request, provider: "eastmoney" }, { now, endpoint })).rejects.toThrow("explicit matching");
});

it("excludes ads, non-stories, malformed attribution and invalid UTC timestamps", async () => {
  const result = await fetchNews(request, { now, endpoint: "ticker-news", transport: async () => [
    { ad: ["advert"], content: story }, { content: { ...story, contentType: "VIDEO" } }, { content: { ...story, provider: {} } },
    { content: { ...story, pubDate: "2026-02-30T12:00:00Z" } }, { content: { ...story, pubDate: "2026-09-11T24:00:00Z" } },
    { content: { ...story, pubDate: "2026-09-11T12:00:00" } }, { content: story },
  ] });
  expect(result.articles).toHaveLength(1); expect(result.attempts[0]!.excluded.invalid).toBe(6);
});

it("retains search failure when the feed succeeds and propagates cancellation during fallback", async () => {
  const result = await fetchNews(request, { now, transport: async (_provider, _query, _signal, endpoint) => {
    if (endpoint === "news-search") throw new Error("Fixture outage"); return [{ content: story }];
  } });
  expect(result.status).toBe("available"); expect(result.attempts.map(item => item.status)).toEqual(["error", "success"]);
  const controller = new AbortController(); let calls = 0;
  await expect(fetchNews(request, { now, signal: controller.signal, transport: async (_provider, _query, _signal, endpoint) => {
    calls++; if (endpoint === "ticker-news") controller.abort(new Error("cancelled")); return [];
  } })).rejects.toThrow("cancelled"); expect(calls).toBe(2);
});
