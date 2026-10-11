import type { NewsArticle, NewsSnapshot } from "../types/news.ts";
import { isInstructionLikeNewsText } from "../research/news-model-view.ts";

function titleTickerTokens(news: NewsSnapshot): string[] {
  const symbol = news.scope.symbol;
  if (news.scope.market === "US") {
    if (symbol.length < 3) return [];
    return [...new Set([symbol, symbol.replaceAll(".", "-"), symbol.replaceAll("-", ".")])];
  }
  const code = symbol.split(".")[0]!;
  if (news.scope.market === "HK") return [...new Set([symbol, `${code.replace(/^0+(?=\d{4})/, "")}.HK`,
    `SEHK:${Number(code)}`, `HKEX:${Number(code)}`, code])];
  return [symbol, ...(code.length >= 5 ? [code] : [])];
}

function titleContainsToken(title: string, tokens: readonly string[]): boolean {
  const upper = title.normalize("NFKC").toUpperCase().replace(/\s+/g, " ");
  return tokens.some(token => {
    let at = upper.indexOf(token);
    while (at >= 0) {
      const before = upper[at - 1], after = upper[at + token.length];
      if ((!before || !/[A-Z0-9]/.test(before)) && (!after || !/[A-Z0-9]/.test(after))) return true;
      at = upper.indexOf(token, at + 1);
    }
    return false;
  });
}

function providerNameTokens(news: NewsSnapshot): string[] {
  if (news.subject?.status !== "provider-claimed") return [];
  const names = news.subject.names.filter(name => !isInstructionLikeNewsText(name)).flatMap(name => {
    const upper = name.normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();
    const withoutLegalSuffix = upper.replace(/\s+(?:INCORPORATED|INC|CORPORATION|CORP|LTD|LIMITED|PLC)\.?$/, "").trim();
    return [upper, withoutLegalSuffix];
  });
  return [...new Set(names.filter(name => name.length >= 4 || /^[\p{Script=Han}]{2,}$/u.test(name)))];
}

function hasConflictingExplicitSymbol(news: NewsSnapshot, title: string): boolean {
  const target = /^(\d{3,6})\.(SZ|SH|BJ|HK|OF)$/.exec(news.scope.symbol);
  if (!target || news.scope.market !== "A" && news.scope.market !== "HK") return false;
  const mentions = [...title.normalize("NFKC").toUpperCase()
    .matchAll(/(?:^|[^A-Z0-9])(\d{3,6})\.(SZ|SH|SS|BJ|HK|OF)(?![A-Z0-9])/g)]
    .filter(match => news.scope.market === "HK" ? Number(match[1]) === Number(target[1]) : match[1] === target[1]);
  // A bare number or provider-claimed name cannot override an explicit different exchange or instrument suffix.
  return mentions.length > 0 && !mentions.some(match => (match[2] === "SS" ? "SH" : match[2]) === target[2]);
}

export type NewsHeadlineSubjectMatch = "title-ticker" | "provider-name" | "unassessed";

/** A title cue from an exact-symbol quote is still a provider claim, not independent company verification. */
export function newsHeadlineSubjectMatch(news: NewsSnapshot, article: NewsArticle): NewsHeadlineSubjectMatch {
  if (isInstructionLikeNewsText(article.title)) return "unassessed";
  if (hasConflictingExplicitSymbol(news, article.title)) return "unassessed";
  if (titleContainsToken(article.title, titleTickerTokens(news))) return "title-ticker";
  if (titleContainsToken(article.title, providerNameTokens(news))) return "provider-name";
  return "unassessed";
}

/** Spends a bounded article-reading budget on explicit ticker headlines first, preserving recency within each group. */
export function selectNewsReadingCandidates(news: NewsSnapshot, limit: number): NewsArticle[] {
  if (limit === 0) return [];
  const ticker: NewsArticle[] = [], named: NewsArticle[] = [], other: NewsArticle[] = [];
  for (const article of news.articles) {
    const match = newsHeadlineSubjectMatch(news, article);
    (match === "title-ticker" ? ticker : match === "provider-name" ? named : other).push(article);
  }
  return [...ticker, ...named, ...other].slice(0, limit);
}
