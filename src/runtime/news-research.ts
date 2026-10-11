import { fetchNews, normalizeNewsScope, providerOrderFor, readNewsDocument } from "../source/index.ts";
import type { NewsRequest, NewsSnapshot } from "../types/news.ts";
import type { DatasetRef } from "../types/data.ts";
import { loadAnalysisBars } from "./analysis-data.ts";
import { normalizeBarSeries } from "../market/bars.ts";
import { priceAdjustmentNote } from "../market/price-adjustment.ts";
import { momentum, volatility } from "../quant/factor.ts";
import { newsSentiment } from "../quant/news-sentiment.ts";
import { newsPriceWindows } from "../quant/news-price-windows.ts";
import { loadDataset } from "../storage/index.ts";
import { isDeepStrictEqual } from "node:util";
import { newsHeadlineSubjectMatch, selectNewsReadingCandidates } from "./news-reading-selection.ts";
import { isInstructionLikeNewsText } from "../research/news-model-view.ts";

export interface NewsResearchOptions {
  signal?: AbortSignal;
  news?: typeof fetchNews;
  prices?: typeof loadAnalysisBars;
  resolveDataset?: typeof loadDataset;
  readDocument?: typeof readNewsDocument;
  articleLimit?: number;
}
export interface NewsPriceEvidence {
  status: "available" | "insufficient" | "unavailable";
  source: string | null;
  origin: string;
  dataset: DatasetRef | null;
  dates: string[];
  factorDates: string[];
  period: number;
  momentum: number | null;
  dailyVolatility: number | null;
  newsWindows: ReturnType<typeof newsPriceWindows>;
  reason: string;
}

export async function researchNews(request: NewsRequest, period = 5, options: NewsResearchOptions = {}) {
  const scope = normalizeNewsScope(request);
  const articleLimit = options.articleLimit ?? 3;
  if (!Number.isInteger(articleLimit) || articleLimit < 0 || articleLimit > 5) throw new Error("Article reading limit must be an integer from 0 to 5.");
  if (!Number.isInteger(period) || period < 2 || period > 252) throw new Error("Momentum period must be an integer from 2 to 252.");
  options.signal?.throwIfAborted();
  // Keep each supplier's failure independent. News failures are retained in the snapshot.
  const news: NewsSnapshot = await (options.news ?? fetchNews)(scope, { signal: options.signal });
  options.signal?.throwIfAborted();
  if (news.scope.symbol !== scope.symbol || news.scope.market !== scope.market || news.scope.start !== scope.start || news.scope.end !== scope.end || news.scope.timezone !== scope.timezone) throw new Error("News response does not match the requested scope.");
  const documents = [];
  for (const article of selectNewsReadingCandidates(news, articleLimit)) {
    const document = await (options.readDocument ?? readNewsDocument)(article, { signal: options.signal });
    options.signal?.throwIfAborted();
    if (document.articleId !== article.id || !article.origins.some(origin => origin.url === document.requestedUrl)) throw new Error("Article response does not match the selected news observation.");
    documents.push(document);
  }
  const price: NewsPriceEvidence = { status: "unavailable", source: null, origin: "unavailable", dataset: null, dates: [], factorDates: [],
    period, momentum: null, dailyVolatility: null, newsWindows: newsPriceWindows(news, []), reason: "No matching price evidence." };
  try {
    const result = await (options.prices ?? loadAnalysisBars)(scope.symbol, period + 1, scope.start, scope.end, options.signal);
    options.signal?.throwIfAborted();
    if (!providerOrderFor(scope.market, "auto").some(source => source === result.source)) throw new Error("Price source is unsupported for the requested market");
    if (result.dataset && (result.dataset.symbol !== scope.symbol || result.dataset.market !== scope.market || result.dataset.source !== result.source
      || result.dataset.requested.start !== scope.start || result.dataset.requested.end !== scope.end)) throw new Error("Price identity mismatch");
    const bars = normalizeBarSeries(result.bars, scope.start, scope.end);
    if (result.dataset && !isDeepStrictEqual(bars, normalizeBarSeries((options.resolveDataset ?? loadDataset)(result.dataset), scope.start, scope.end))) throw new Error("Price archive mismatch");
    price.source = result.source; price.origin = result.origin; price.dataset = result.dataset ?? null;
    price.dates = bars.map(bar => bar.date);
    if (bars.length >= period + 1) {
      const closes = bars.map(bar => bar.close);
      price.status = "available";
      price.factorDates = bars.slice(-(period + 1)).map(bar => bar.date);
      price.momentum = momentum(closes, period).at(-1) ?? null;
      price.dailyVolatility = volatility(closes, period).at(-1) ?? null;
      if (price.momentum === null || price.dailyVolatility === null || !Number.isFinite(price.momentum) || !Number.isFinite(price.dailyVolatility)) throw new Error("Undefined price factors");
      price.reason = "Momentum and daily sample volatility use only factorDates (the last period+1 closes), not every date in the research window. Values are fractions, not percentages. "
        + priceAdjustmentNote(result.dataset?.adjustment ?? result.adjustment ?? "provider-unspecified");
    } else { price.status = "insufficient"; price.reason = `Need ${period + 1} daily observations inside the requested window; found ${bars.length}.`; }
    price.newsWindows = newsPriceWindows(news, bars);
  } catch {
    options.signal?.throwIfAborted();
    price.status = "unavailable"; price.momentum = null; price.dailyVolatility = null; price.factorDates = [];
    price.source = null; price.origin = "unavailable"; price.dataset = null; price.dates = [];
    price.newsWindows = newsPriceWindows(news, []);
    price.reason = "Price request failed or returned a mismatched dataset; news remains available independently.";
  }
  options.signal?.throwIfAborted();
  const targetArticleIds = new Set(news.articles.filter(article => newsHeadlineSubjectMatch(news, article) !== "unassessed")
    .map(article => article.id));
  const withheldHeadlineIds = new Set(news.articles.filter(article => isInstructionLikeNewsText(article.title)).map(article => article.id));
  const sentiment = newsSentiment(news, targetArticleIds, withheldHeadlineIds);
  const blockers: string[] = [];
  if (withheldHeadlineIds.size) blockers.push("An instruction-like candidate headline was excluded from title triage; review the source before considering a directional adjustment.");
  if (news.status !== "available") blockers.push(`News ${news.status}; no in-window news evidence.`);
  if (news.attempts.some(attempt => attempt.status === "error")) blockers.push("A news provider failed; coverage is incomplete.");
  if (!targetArticleIds.size && news.articles.length) blockers.push("No headline names the requested ticker or an exact-symbol provider-claimed company name; target title tone is unassessed.");
  else if (sentiment.tone === "unknown") blockers.push("No interpretable directional title evidence for the target candidate.");
  const readableTargetBodies = new Set(documents.filter(document =>
    (document.status === "available" || document.status === "truncated")
      && document.paragraphs.some(paragraph => !isInstructionLikeNewsText(paragraph.text))).map(document => document.articleId));
  if (sentiment.items.some(item => item.includedInTargetTone && item.tone !== "unknown" && !readableTargetBodies.has(item.id)))
    blockers.push("At least one directional target headline has no readable body; title-only tone cannot support a directional adjustment.");
  if (sentiment.items.some(item => !item.includedInTargetTone && item.tone !== "unknown"))
    blockers.push("A directional candidate headline has no target-subject title cue; review its company before considering an adjustment.");
  if (price.status !== "available") blockers.push(price.reason);
  if (price.momentum === 0) blockers.push("Price momentum is flat; there is no directional price confirmation.");
  if (price.origin === "stale-cache") blockers.push("Price refresh failed; stale cached prices cannot confirm a current adjustment.");
  if (!price.dataset) blockers.push("No immutable price reference; the comparison cannot be reproduced from archived observations.");
  const priceEnd = price.dates.at(-1);
  if (priceEnd && news.articles.some(article => targetArticleIds.has(article.id) && article.marketDate >= priceEnd))
    blockers.push("Target-candidate news on or after the last price date has no confirmed subsequent daily close; do not infer a price reaction.");
  let conflict = sentiment.tone === "mixed" || sentiment.tone === "positive" && price.momentum !== null && price.momentum < 0
    || sentiment.tone === "negative" && price.momentum !== null && price.momentum > 0;
  for (const window of price.newsWindows.windows) {
    const item = sentiment.items.find(item => item.id === window.articleId);
    const tone = item?.includedInTargetTone ? item.tone : "unknown";
    if (tone !== "positive" && tone !== "negative") continue;
    if (window.subsequentReturn === null) blockers.push(`${window.articleId}: Need at least two valid closes on strictly later market dates to assess subsequent direction.`);
    else if (window.subsequentReturn === 0) blockers.push(`${window.articleId}: Subsequent prices are flat; earlier window momentum does not confirm a later direction.`);
    else if (tone === "positive" && window.subsequentReturn < 0 || tone === "negative" && window.subsequentReturn > 0) conflict = true;
  }
  const status = blockers.length ? "insufficient" : conflict ? "conflicting" : "conditional";
  const suggestion = status === "insufficient" ? "Keep the proposed allocation change undecided; resolve the listed evidence gaps before reviewing an adjustment."
    : status === "conflicting" ? "Separate opposing claims and verify their dates and subjects. Defer a directional allocation change until the conflict is resolved."
      : sentiment.tone === "negative" ? "If the original reports confirm deterioration and subsequent prices continue weakening, review reducing the hypothetical target exposure within an explicitly chosen risk budget."
        : "If the original reports confirm improvement and subsequent prices sustain the move, review a gradual increase in hypothetical target exposure within an explicitly chosen risk budget.";
  return { version: 2 as const, kind: "news-research" as const, symbol: scope.symbol, market: scope.market, start: scope.start, end: scope.end,
    news, documents, citations: documents.map((document, index) => ({ id: `N-${news.contentHash.slice(0, 16)}-${index + 1}`,
      articleId: document.articleId, contentHash: document.contentHash, requestedUrl: document.requestedUrl, status: document.status,
      paragraphIds: document.paragraphs.map(paragraph => paragraph.id) })),
    reading: { requested: articleLimit, omitted: Math.max(0, news.articles.length - documents.length),
      selection: "headline-subject-cues-first-v2" as const,
      usable: documents.filter(document => (document.status === "available" || document.status === "truncated")
        && document.paragraphs.some(paragraph => !isInstructionLikeNewsText(paragraph.text))).length,
      guidance: "The limited body-reading budget prioritizes explicit ticker headlines, then exact-symbol provider-claimed company names, then recency. These lexical cues select candidates and scope title triage; they do not verify company identity or the article's claims. Copy a citation id from citations and cite [citationId/pN], or [citationId/restricted] for a restricted body. For two paragraphs, repeat the full token: [citationId/p1] [citationId/p2]; never abbreviate it as [citationId/p1, /p2]. Do not use [citationId] alone; an article mapping key without a paragraph is not a citation. The table maps each id to the original articleId/contentHash; never shorten or invent IDs. Resolve citations within this result's news snapshot, not across studies. Distinguish source claims, your interpretation and headline-phrases-v1. Do not infer missing bodies or calibrated probabilities." },
    sentiment, price, dataset: price.dataset,
    evidenceBoundary: { publisherClaims: "unverified" as const,
      extractedText: documents.some(document => (document.status === "available" || document.status === "truncated")
        && document.paragraphs.some(paragraph => !isInstructionLikeNewsText(paragraph.text)))
        ? "observed-page" as const : "unavailable" as const,
      namedPricePattern: price.newsWindows.patternAssessment.status,
      targetCompanyRelation: { status: "unassessed" as const,
        reason: "A candidate route or exact-symbol provider name does not verify the target-company subject. Absence of target-company metrics does not prove irrelevance or disprove a possible company link; report only what the page actually says." },
      explanation: "Page text is an observation, not independently verified company fact. Title, publisher and publication time are provider claims. No named price pattern was tested; report only the observed closes and returns." },
    adjustment: { status, suggestion, blockers, evidence: { articleIds: sentiment.items.filter(item => item.includedInTargetTone && item.tone !== "unknown").map(item => item.id),
      priceDates: price.dates, priceRevision: price.dataset?.revision ?? null, newsWindowMethod: price.newsWindows.method },
    assumptions: ["Hypothetical allocation review only; no account holdings, target size or orders are inferred.",
      "Title tone and same-window momentum do not prove causality or predict returns. Confirm company relevance and primary reports.",
      "Volatility is a daily sample statistic; a personal risk budget and portfolio-level risk check are still required."] } };
}
