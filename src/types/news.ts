import type { Market } from "./data.ts";

export type NewsProvider = "yahoo" | "eastmoney";
export type NewsEndpoint = "news-search" | "ticker-news" | "stock_news_em";
export interface NewsRequest {
  symbol: string;
  market: Market;
  start: string;
  end: string;
  provider?: NewsProvider | "auto";
}
export interface NewsScope extends NewsRequest { timezone: string }
export interface NewsOrigin {
  provider: NewsProvider;
  endpoint: NewsEndpoint;
  publisher: string;
  url: string;
  providerId: string | null;
  publishedAt: string;
}
export interface NewsArticle {
  id: string;
  title: string;
  publishedAt: string;
  marketDate: string;
  relevance: "provider-tag" | "ticker-feed" | "search-match";
  origins: NewsOrigin[];
}
export interface NewsAttempt {
  provider: NewsProvider;
  endpoint: NewsEndpoint;
  query: string;
  status: "success" | "empty" | "error" | "unsupported";
  received: number;
  accepted: number;
  excluded: { invalid: number; unrelated: number; beforeWindow: number; afterWindow: number; future: number; duplicates: number };
  reason?: string;
}
export interface NewsSubjectHint {
  status: "provider-claimed" | "unavailable";
  symbol: string;
  names: string[];
  source: "yahoo-search-quote" | "eastmoney-stock-quote" | null;
}
export interface NewsSnapshot {
  version: 1;
  scope: NewsScope;
  observedAt: string;
  status: "available" | "empty" | "outside-window" | "unavailable";
  articles: NewsArticle[];
  /** An exact-symbol provider name is a selection hint, not verified company identity. */
  subject?: NewsSubjectHint;
  omittedArticles: number;
  attempts: NewsAttempt[];
  contentHash: string;
  limitations: string[];
}
