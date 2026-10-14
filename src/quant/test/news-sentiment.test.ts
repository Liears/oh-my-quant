import { expect, test } from "bun:test";
import { newsSentiment } from "../news-sentiment.ts";
import type { NewsSnapshot } from "../../types/news.ts";

function snapshot(titles: string[]): NewsSnapshot {
  return { version: 1, scope: { symbol: "AAPL", market: "US", start: "2026-09-01", end: "2026-09-10", timezone: "America/New_York" },
    status: "available", observedAt: "2026-09-14T00:00:00Z", contentHash: "synthetic-headlines", attempts: [], limitations: [], omittedArticles: 0,
    articles: titles.map((title, index) => ({ id: `article-${index}`, title, publishedAt: "2026-09-07T12:00:00Z",
      marketDate: "2026-09-07", relevance: "provider-tag", origins: [] })) };
}

test.each([
  "AAPL didn't beat estimates", "AAPL doesn’t cut guidance", "AAPL hasn't been upgraded",
  "AAPL won’t cut guidance", "AAPL can’t beat earnings estimates", "AAPL isn’t downgraded",
  "AAPL cannot beat estimates", "AAPL would raise guidance", "AAPL might cut guidance",
  "If revenue improves, AAPL raises guidance", "Unless demand weakens, AAPL raises guidance",
  "AAPL is expected to report record profit", "AAPL disputes claims it was downgraded",
  "AAPL 未上调评级", "AAPL 未出现净利润增长", "AAPL 没有债务违约",
  "AAPL 并非净利润下降", "AAPL 不下调评级", "若需求改善，AAPL 利润增长",
  "如果成本回落，AAPL 扭亏为盈", "除非融资完成，AAPL 债务违约",
])("does not turn a denied or conditional headline into a directional observation: %s", title => {
  const result = newsSentiment(snapshot([title]));
  expect(result.items[0]!.positive.length + result.items[0]!.negative.length).toBeGreaterThan(0);
  expect(result.items[0]!.tone).toBe("unknown");
  expect(result.tone).toBe("unknown"); expect(result.counts.unknown).toBe(1);
  expect(result.items[0]!.uncertainty).toContain("manual review");
  expect(result.probabilityInterval).toBeNull(); expect(result.confidence).toBe("low");
});

test.each([
  ["AAPL beats earnings estimates", "positive"], ["AAPL raises guidance", "positive"],
  ["AAPL upgraded", "positive"], ["AAPL 净利润增长", "positive"],
  ["AAPL misses estimates", "negative"], ["AAPL cuts guidance", "negative"],
  ["AAPL 债务违约", "negative"], ["AAPL 上调评级但净利润下降", "mixed"],
  ["AAPL platform update", "unknown"],
] as const)("preserves unqualified phrase triage for %s", (title, tone) => {
  const result = newsSentiment(snapshot([title]));
  expect(result.items[0]!.tone).toBe(tone); expect(result.tone).toBe(tone);
});

test("denied headlines do not add a false opposing signal to an affirmative target observation", () => {
  const input = snapshot(["AAPL won't cut guidance", "AAPL beats estimates", "Other company downgraded"]);
  const original = structuredClone(input);
  const result = newsSentiment(input, new Set(["article-0", "article-1"]));
  expect(result.tone).toBe("positive");
  expect(result.counts).toEqual({ positive: 1, negative: 0, mixed: 0, unknown: 1 });
  expect(result.candidateCounts).toEqual({ positive: 1, negative: 1, mixed: 0, unknown: 1 });
  expect(input).toEqual(original);
});

test("withheld titles still cannot expose phrase hits or directional interpretation", () => {
  const result = newsSentiment(snapshot(["AAPL raises guidance"]), undefined, new Set(["article-0"]));
  expect(result.tone).toBe("unknown");
  expect(result.items[0]).toMatchObject({ positive: [], negative: [], headlineWithheld: true });
});
