import { createHash } from "node:crypto";
import { isAIndexSymbol, normalizeSymbol } from "../../market/symbols.ts";
import { isDailyDate, validateDateRange } from "../../market/bars.ts";
import type { NewsArticle, NewsAttempt, NewsEndpoint, NewsProvider, NewsRequest, NewsScope, NewsSnapshot, NewsSubjectHint } from "../../types/news.ts";
import { fetchNewsRows, type NewsTransport } from "./news-providers.ts";

export function normalizeNewsScope(request: NewsRequest): NewsScope {
  validateDateRange(request.start, request.end);
  if (!request.start || !request.end) throw new Error("News requires explicit start and end dates.");
  if (!["A", "US", "HK"].includes(request.market)) throw new Error("News market must be A, US or HK.");
  if (request.provider !== undefined && !["auto", "yahoo", "eastmoney"].includes(request.provider)) throw new Error("Unknown news provider.");
  let symbol = request.symbol.trim().toUpperCase();
  if (request.market === "HK" && /^\d{4,5}\.HK$/.test(symbol)) symbol = `${symbol.slice(0, -3).padStart(5, "0")}.HK`;
  else symbol = normalizeSymbol(symbol, request.market);
  if (request.market === "A" && /^[036]\d{5}\.(?:SH|SZ|BJ)$/.test(symbol)
    && symbol !== `${symbol.slice(0, 6)}.${symbol.startsWith("6") ? "SH" : "SZ"}`)
    throw new Error("A-share code does not match the requested exchange.");
  if (request.market === "A" ? !/^\d{6}\.(SH|SZ|BJ)$/.test(symbol) || isAIndexSymbol(symbol)
    : request.market === "HK" ? !/^\d{5}\.HK$/.test(symbol)
      : !/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/.test(symbol)) throw new Error("Symbol does not match the news market; funds and A-share indexes need a separate news scope.");
  return { symbol, market: request.market, start: request.start, end: request.end, provider: request.provider ?? "auto",
    timezone: request.market === "US" ? "America/New_York" : request.market === "HK" ? "Asia/Hong_Kong" : "Asia/Shanghai" };
}

export function newsProviderQuery(scope: NewsScope, provider: NewsProvider): string | null {
  if (provider === "eastmoney") return scope.market === "A" ? scope.symbol.slice(0, 6) : null;
  if (scope.market === "A") return scope.symbol.endsWith(".BJ") ? null : scope.symbol.replace(/\.SH$/, ".SS");
  if (scope.market === "HK") return `${scope.symbol.slice(0, -3).replace(/^0+(?=\d{4})/, "")}.HK`;
  return scope.symbol.replaceAll(".", "-");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ").trim() : "";
}
function providerSubject(quotes: unknown, query: string): NewsSubjectHint | null {
  if (!Array.isArray(quotes)) return null;
  const exact = quotes.find(value => value && typeof value === "object" && !Array.isArray(value)
    && typeof value.symbol === "string" && value.symbol.toUpperCase() === query.toUpperCase()
    && value.quoteType === "EQUITY") as Record<string, unknown> | undefined;
  if (!exact) return null;
  const names = [...new Set([exact.shortname, exact.longname].map(text)
    .filter(name => name.length >= 3 && name.length <= 120 && /^[\p{L}\p{N}][\p{L}\p{N} .,&'()/-]*$/u.test(name)))];
  return names.length ? { status: "provider-claimed", symbol: query.toUpperCase(), names, source: "yahoo-search-quote" } : null;
}
function eastmoneySubject(quote: unknown, code: string, symbol: string): NewsSubjectHint | null {
  if (!/^[036]\d{5}$/.test(code) || symbol !== `${code}.${code.startsWith("6") ? "SH" : "SZ"}`) return null;
  if (!quote || typeof quote !== "object" || Array.isArray(quote)) return null;
  const row = quote as Record<string, unknown>;
  if (row.f57 !== code) return null;
  const name = text(row.f58);
  if (name.length < 2 || name.length > 40 || !/^[\p{L}\p{N} .·&()-]+$/u.test(name)) return null;
  return { status: "provider-claimed", symbol, names: [name], source: "eastmoney-stock-quote" };
}
function originalUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096 || /[\x00-\x20\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function urlKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(guccounter|guce_referrer|ncid|soc_src|soc_trk)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
function publishedTime(value: unknown, provider: NewsProvider, endpoint: NewsEndpoint): string | null {
  if (endpoint === "ticker-news") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value) || !isDailyDate(value.slice(0, 10))) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
  if (provider === "yahoo") return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 253402300800
    ? new Date(value * 1000).toISOString() : null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) || !isDailyDate(value.slice(0, 10))) return null;
  const time = Date.parse(`${value.replace(" ", "T")}+08:00`);
  return Number.isFinite(time) && new Date(time + 8 * 3600_000).toISOString().slice(0, 19) === value.replace(" ", "T") ? new Date(time).toISOString() : null;
}
export function newsMarketDate(time: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(time));
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}

/** Bounded search observations, never an exhaustive historical feed or an inferred account state. */
export async function fetchNews(request: NewsRequest, options: { signal?: AbortSignal; transport?: NewsTransport; now?: () => Date; endpoint?: NewsEndpoint } = {}): Promise<NewsSnapshot> {
  const scope = normalizeNewsScope(request), transport = options.transport ?? fetchNewsRows;
  const observedAt = (options.now?.() ?? new Date()).toISOString();
  if (scope.end > newsMarketDate(observedAt, scope.timezone)) throw new Error("News end date cannot be in the future for the selected market.");
  const providers: NewsProvider[] = scope.provider !== "auto" && scope.provider ? [scope.provider] : scope.market === "A" ? ["eastmoney", "yahoo"] : ["yahoo"];
  if (options.endpoint && (scope.provider === "auto" || !["news-search", "ticker-news", "stock_news_em"].includes(options.endpoint)
    || (options.endpoint === "stock_news_em" ? scope.provider !== "eastmoney" : scope.provider !== "yahoo"))) throw new Error("Endpoint checks require an explicit matching news provider.");
  const routes = providers.flatMap(provider => (provider === "yahoo" ? ["news-search", "ticker-news"] as const : ["stock_news_em"] as const).map(endpoint => ({ provider, endpoint })))
    .filter(route => !options.endpoint || route.endpoint === options.endpoint);
  const articles: NewsArticle[] = [], attempts: NewsAttempt[] = [];
  let subject: NewsSubjectHint = { status: "unavailable", symbol: scope.symbol, names: [], source: null };
  const byUrl = new Map<string, NewsArticle>(), byTitle = new Map<string, NewsArticle>();
  for (const { provider, endpoint } of routes) {
    options.signal?.throwIfAborted();
    if (endpoint === "ticker-news" && !options.endpoint && attempts.some(attempt => attempt.provider === "yahoo" && attempt.status === "success")) continue;
    const query = newsProviderQuery(scope, provider);
    const attempt: NewsAttempt = { provider, endpoint, query: query ?? scope.symbol, status: "empty", received: 0, accepted: 0,
      excluded: { invalid: 0, unrelated: 0, beforeWindow: 0, afterWindow: 0, future: 0, duplicates: 0 } };
    attempts.push(attempt);
    if (query === null) { attempt.status = "unsupported"; attempt.reason = "Provider has no mapping for this market/symbol."; continue; }
    try {
      const response = await transport(provider, query, options.signal, endpoint);
      options.signal?.throwIfAborted();
      const envelope = response && typeof response === "object" && !Array.isArray(response) ? response as Record<string, unknown> : null;
      const rows = Array.isArray(response) ? response : envelope?.rows;
      if (!Array.isArray(rows) || rows.length > 100) throw new Error("Invalid news rows");
      if (provider === "eastmoney" && endpoint === "stock_news_em") subject = eastmoneySubject(envelope?.quote, query, scope.symbol) ?? subject;
      if (provider === "yahoo" && endpoint === "news-search" && subject.status === "unavailable") subject = providerSubject(envelope?.quotes, query) ?? subject;
      attempt.received = rows.length;
      for (const value of rows) {
        if (!value || typeof value !== "object" || Array.isArray(value)) { attempt.excluded.invalid++; continue; }
        let row = value as Record<string, unknown>;
        if (endpoint === "ticker-news") {
          const content = row.content;
          if ((Array.isArray(row.ad) ? row.ad.length > 0 : row.ad) || !content || typeof content !== "object" || Array.isArray(content) || !("contentType" in content) || content.contentType !== "STORY") { attempt.excluded.invalid++; continue; }
          row = content as Record<string, unknown>;
        }
        const title = text(row[provider === "yahoo" ? "title" : "新闻标题"]);
        const metadata = endpoint === "ticker-news" && row.provider && typeof row.provider === "object" ? row.provider as Record<string, unknown> : {};
        const canonical = endpoint === "ticker-news" && row.canonicalUrl && typeof row.canonicalUrl === "object" ? row.canonicalUrl as Record<string, unknown> : {};
        const publisher = text(endpoint === "ticker-news" ? metadata.displayName : row[provider === "yahoo" ? "publisher" : "文章来源"]);
        const url = originalUrl(endpoint === "ticker-news" ? canonical.url : row[provider === "yahoo" ? "link" : "新闻链接"]);
        const publishedAt = publishedTime(row[endpoint === "ticker-news" ? "pubDate" : provider === "yahoo" ? "providerPublishTime" : "发布时间"], provider, endpoint);
        if (!title || title.length > 600 || !publisher || publisher.length > 200 || !url || !publishedAt) { attempt.excluded.invalid++; continue; }
        if (endpoint === "news-search" && (!Array.isArray(row.relatedTickers) || !row.relatedTickers.some(ticker => typeof ticker === "string" && ticker.toUpperCase() === query))) { attempt.excluded.unrelated++; continue; }
        if (provider === "eastmoney" && row["关键词"] !== query) { attempt.excluded.unrelated++; continue; }
        const marketDate = newsMarketDate(publishedAt, scope.timezone);
        if (publishedAt > observedAt) { attempt.excluded.future++; continue; }
        if (marketDate < scope.start) { attempt.excluded.beforeWindow++; continue; }
        if (marketDate > scope.end) { attempt.excluded.afterWindow++; continue; }
        const normalizedTitle = title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
        const key = `${urlKey(url)}:${normalizedTitle}`, titleKey = `${marketDate}:${normalizedTitle}`;
        const providerId = row[endpoint === "ticker-news" ? "id" : "uuid"];
        const origin = { provider, endpoint, publisher, url, publishedAt, providerId: provider === "yahoo" && typeof providerId === "string" ? text(providerId).slice(0, 200) : null };
        const relevance = endpoint === "ticker-news" ? "ticker-feed" : provider === "yahoo" ? "provider-tag" : "search-match";
        const duplicate = byUrl.get(key) ?? byTitle.get(titleKey);
        if (duplicate) {
          attempt.excluded.duplicates++;
          if (!duplicate.origins.some(item => item.provider === provider && item.endpoint === endpoint && item.url === url && item.publishedAt === publishedAt)) duplicate.origins.push(origin);
          if (publishedAt > duplicate.publishedAt) {
            duplicate.publishedAt = publishedAt; duplicate.marketDate = marketDate;
            duplicate.id = createHash("sha256").update(titleKey).digest("hex");
          }
          if (relevance === "provider-tag" || duplicate.relevance === "search-match") duplicate.relevance = relevance;
          byUrl.set(key, duplicate); byTitle.set(titleKey, duplicate);
          continue;
        }
        const article: NewsArticle = { id: createHash("sha256").update(titleKey).digest("hex"), title, publishedAt, marketDate,
          relevance, origins: [origin] };
        articles.push(article); byUrl.set(key, article); byTitle.set(titleKey, article); attempt.accepted++;
      }
      attempt.status = attempt.accepted || attempt.excluded.duplicates ? "success" : "empty";
    } catch {
      options.signal?.throwIfAborted();
      attempt.status = "error";
      attempt.reason = "News request failed, timed out, or returned an invalid response; no cached news substituted.";
    }
  }
  options.signal?.throwIfAborted();
  articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  const omittedArticles = Math.max(0, articles.length - 30);
  articles.splice(30);
  const status = articles.length ? "available" : attempts.every(attempt => ["error", "unsupported"].includes(attempt.status)) ? "unavailable"
    : attempts.some(attempt => attempt.excluded.beforeWindow || attempt.excluded.afterWindow) ? "outside-window" : "empty";
  return { version: 1, scope, observedAt, status, articles, subject, omittedArticles, attempts,
    contentHash: createHash("sha256").update(JSON.stringify({ scope, observedAt, articles, subject, attempts })).digest("hex"),
    limitations: ["Recent search results only; date filtering does not retrieve a complete historical archive. At most 30 unique articles are retained; omittedArticles reports additional matches.",
      "Publisher and publication time are provider claims, not independently verified facts. This search snapshot contains metadata only; any article documents are separate observations.",
      "A subject name from an exact-code provider quote is an optional headline-selection hint, not verified company identity. Quote failure does not invalidate independently returned news; no target name means title-based target tone can remain unknown.",
      "provider-tag, ticker-feed and search-match identify different candidate routes: route labels, not calibrated or ordered evidence tiers. A ticker tag, symbol-bound feed or keyword match does not itself verify that the article discusses the target company; each still needs company/subject review.",
      "Duplicates require the same normalized title plus canonical URL or publication day; changed titles remain separate claims. Syndication is not independent confirmation."] };
}
