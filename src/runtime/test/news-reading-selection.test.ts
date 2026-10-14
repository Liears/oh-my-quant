import { expect, test } from "bun:test";
import type { NewsArticle, NewsSnapshot } from "../../types/news.ts";
import { newsHeadlineSubjectMatch, selectNewsReadingCandidates } from "../research/news-reading-selection.ts";

function article(id: string, title: string): NewsArticle {
  return { id, title, publishedAt: "2026-09-17T12:00:00.000Z", marketDate: "2026-09-17",
    relevance: "provider-tag", origins: [] };
}

test("HK Yahoo short code can use the reading budget before a newer unrelated ticker-feed item", () => {
  const news = { scope: { symbol: "00700.HK", market: "HK" }, articles: [
    article("newer", "Technology ETF gains today"), article("target", "Tencent (SEHK:700) reports an update"),
    article("also-target", "Tencent (0700.HK) signs a partnership"),
  ] } as NewsSnapshot;
  expect(selectNewsReadingCandidates(news, 2).map(item => item.id)).toEqual(["target", "also-target"]);
  expect(selectNewsReadingCandidates(news, 0)).toEqual([]);
});

test("short US symbols do not match ordinary words in unrelated titles", () => {
  const news = { scope: { symbol: "IT", market: "US" }, articles: [
    article("newer", "Is It Time to Watch Rates?"), article("older", "IT (IT) announces an update"),
  ] } as NewsSnapshot;
  expect(selectNewsReadingCandidates(news, 1).map(item => item.id)).toEqual(["newer"]);
});

test("an exact-symbol provider name restores company-word headlines without promoting ticker-feed-only stories", () => {
  const news = { scope: { symbol: "AAPL", market: "US" }, subject: { status: "provider-claimed", symbol: "AAPL",
    names: ["Apple Inc."], source: "yahoo-search-quote" }, articles: [
    article("unrelated", "Microsoft raises guidance"), article("named", "Apple raises guidance"),
    article("ticker", "AAPL reports a product update"),
  ] } as NewsSnapshot;
  expect(selectNewsReadingCandidates(news, 2).map(item => item.id)).toEqual(["ticker", "named"]);
  expect(newsHeadlineSubjectMatch(news, news.articles[0]!)).toBe("unassessed");
  expect(newsHeadlineSubjectMatch(news, news.articles[1]!)).toBe("provider-name");
});

test("an exact-code Eastmoney short name prioritizes A-share headlines over sector news", () => {
  const news = { scope: { symbol: "000001.SZ", market: "A" }, subject: { status: "provider-claimed", symbol: "000001.SZ",
    names: ["平安银行"], source: "eastmoney-stock-quote" }, articles: [
    article("sector", "银行板块资金流出"), article("named", "平安银行净利润增长"),
  ] } as NewsSnapshot;
  expect(selectNewsReadingCandidates(news, 1).map(item => item.id)).toEqual(["named"]);
  expect(newsHeadlineSubjectMatch(news, news.articles[1]!)).toBe("provider-name");
});

test("an explicit different-market suffix cannot become the target through a bare code or provider name", () => {
  const news = { scope: { symbol: "000001.SZ", market: "A" }, subject: { status: "provider-claimed", symbol: "000001.SZ",
    names: ["平安银行"], source: "eastmoney-stock-quote" }, articles: [
    article("other-exchange", "000001.SH 上调评级"),
    article("other-yahoo-exchange", "000001.SS 上调评级"),
    article("other-kind", "平安银行 000001.OF 利润增长"),
    article("bare", "000001 利润增长"),
    article("exact", "000001.SZ 利润增长"),
    article("both", "000001.SH 与 000001.SZ 比较"),
  ] } as NewsSnapshot;
  expect(news.articles.map(item => newsHeadlineSubjectMatch(news, item))).toEqual([
    "unassessed", "unassessed", "unassessed", "title-ticker", "title-ticker", "title-ticker",
  ]);
  expect(selectNewsReadingCandidates(news, 3).map(item => item.id)).toEqual(["bare", "exact", "both"]);
  const sh = { ...news, scope: { symbol: "000001.SH", market: "A" } } as NewsSnapshot;
  expect(newsHeadlineSubjectMatch(sh, article("sh-alias", "000001.SS 上调评级"))).toBe("title-ticker");
});

test("HK short-code aliases also reject a conflicting explicit market suffix", () => {
  const news = { scope: { symbol: "00700.HK", market: "HK" }, subject: { status: "provider-claimed", symbol: "00700.HK",
    names: ["Tencent"], source: "yahoo-search-quote" }, articles: [
    article("other-exchange", "Tencent 0700.SH announces update"),
    article("target", "Tencent 0700.HK announces update"),
  ] } as NewsSnapshot;
  expect(news.articles.map(item => newsHeadlineSubjectMatch(news, item))).toEqual(["unassessed", "title-ticker"]);
});
