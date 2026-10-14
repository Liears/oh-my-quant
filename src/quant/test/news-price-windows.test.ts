import { expect, it } from "bun:test";
import { newsPriceWindows } from "../news-price-windows.ts";
import { fetchNews } from "../../source/src/news.ts";
import type { Bar } from "../../types/data.ts";
import type { NewsSnapshot } from "../../types/news.ts";

const snapshot: NewsSnapshot = {
  version: 1, scope: { symbol: "AAPL", market: "US", start: "2026-09-01", end: "2026-09-11", timezone: "America/New_York" },
  status: "available", observedAt: "2026-09-14T00:00:00Z", contentHash: "fixture", attempts: [], limitations: [], omittedArticles: 0,
  articles: [{ id: "article-1", title: "Fixture", publishedAt: "2026-09-08T12:00:00Z", marketDate: "2026-09-08", relevance: "provider-tag", origins: [] }],
};
function bar(day: number, close: number): Bar {
  return { date: `2026-09-${String(day).padStart(2, "0")}`, open: close, high: close, low: close, close, volume: 1, amount: 1 };
}

it("separates the surrounding return from the strictly subsequent return and excludes same-day closes", () => {
  const input = [bar(7, 100), bar(8, 999), bar(9, 120), bar(10, 115), bar(11, 110)];
  const original = structuredClone(input);
  const result = newsPriceWindows(snapshot, input), window = result.windows[0]!;
  expect(window.before).toEqual({ date: "2026-09-07", close: 100 });
  expect(window.firstAfter).toEqual({ date: "2026-09-09", close: 120 });
  expect(window.lastAfter).toEqual({ date: "2026-09-11", close: 110 });
  expect(window.afterDates).toEqual(["2026-09-09", "2026-09-10", "2026-09-11"]);
  expect(window.aroundPublicationReturn).toBeCloseTo(0.2, 12);
  expect(window.subsequentReturn).toBeCloseTo(-1 / 12, 12);
  expect(result.limitation).toContain("Neither is a causal news effect");
  expect(result.patternAssessment).toEqual({ status: "unassessed", rule: null,
    reason: "No prespecified price-pattern rule or comparison baseline was evaluated; these closes support only the listed observed returns. Do not assign a named pattern to this window, even as a hypothesis." });
  expect(result.patternAssessment.reason).not.toContain("news-exhaustion");
  expect(input).toEqual(original);
});

it("preserves missing baselines, one later close and observation gaps without inventing zero returns", () => {
  const empty = newsPriceWindows(snapshot, []).windows[0]!;
  expect(empty).toMatchObject({ before: null, firstAfter: null, lastAfter: null, afterDates: [], aroundPublicationReturn: null, subsequentReturn: null });
  const one = newsPriceWindows(snapshot, [bar(9, 100)]).windows[0]!;
  expect(one.subsequentReturn).toBeNull(); expect(one.aroundPublicationReturn).toBeNull();
  expect(newsPriceWindows(snapshot, [bar(9, 100), bar(10, 110)]).patternAssessment.status).toBe("unassessed");
  const gap = newsPriceWindows(snapshot, [bar(9, 100), bar(11, 100)]).windows[0]!;
  expect(gap.afterDates).toEqual(["2026-09-09", "2026-09-11"]);
  expect(gap.subsequentReturn).toBe(0); expect(gap.aroundPublicationReturn).toBeNull();
});

it("uses corrected in-scope observations and leaves non-finite derived returns unavailable", () => {
  const input = [bar(12, 1000), bar(11, 110), bar(7, 100), bar(9, 200), bar(9, 100)];
  const window = newsPriceWindows(snapshot, input).windows[0]!;
  expect(window.afterDates).toEqual(["2026-09-09", "2026-09-11"]);
  expect(window.subsequentReturn).toBeCloseTo(0.1, 12);
  const extreme = newsPriceWindows(snapshot, [bar(7, 1e-300), bar(9, 1e300), bar(11, 1e300)]).windows[0]!;
  expect(extreme.aroundPublicationReturn).toBeNull(); expect(extreme.subsequentReturn).toBe(0);
});

it.each(["US", "HK", "A"] as const)("aligns publication in %s to the source's market date rather than its UTC date", async market => {
  const symbol = market === "US" ? "AAPL" : market === "HK" ? "00700.HK" : "000001.SZ";
  const publishedAt = "2026-09-09T00:30:00.000Z";
  const news = await fetchNews({ symbol, market, provider: "yahoo", start: "2026-09-01", end: "2026-09-11" }, {
    now: () => new Date("2026-09-14T00:00:00Z"),
    transport: async (_provider, query) => [{ title: "Fixture company raises guidance", publisher: "Fixture News", link: "https://example.com/news", relatedTickers: [query], providerPublishTime: Date.parse(publishedAt) / 1000 }],
  });
  const result = newsPriceWindows(news, [bar(7, 100), bar(8, 105), bar(9, 110), bar(10, 120), bar(11, 115)]);
  const window = result.windows[0]!;
  expect(window.publishedAt).toBe(publishedAt);
  expect(window.marketDate).toBe(market === "US" ? "2026-09-08" : "2026-09-09");
  expect(window.firstAfter?.date).toBe(market === "US" ? "2026-09-09" : "2026-09-10");
  expect(window.subsequentReturn).toBeCloseTo(market === "US" ? 115 / 110 - 1 : 115 / 120 - 1, 12);
});
