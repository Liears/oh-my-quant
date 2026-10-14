import type { Bar } from "../types/data.ts";
import type { NewsSnapshot } from "../types/news.ts";
import { normalizeBarSeries } from "../market/bars.ts";

type CloseObservation = { date: string; close: number };
function priceReturn(first: CloseObservation | null, last: CloseObservation | null): number | null {
  if (!first || !last || first.date === last.date) return null;
  const value = last.close / first.close - 1;
  return Number.isFinite(value) ? value : null;
}

/** Observed daily windows only: no intraday event ordering or causal/abnormal-return estimate. */
export function newsPriceWindows(news: NewsSnapshot, bars: readonly Bar[]) {
  const closes = normalizeBarSeries(bars, news.scope.start, news.scope.end).map(({ date, close }) => ({ date, close }));
  return {
    method: "publication-date-closes-v1" as const,
    timezone: news.scope.timezone,
    basis: "Exclude the publication market date. Before = last observed earlier close; after = observed closes on strictly later market dates within the requested window. Missing dates are not filled or assumed to be trading holidays.",
    limitation: "Around-publication return includes the publication date and any observation gaps. Subsequent return compares the first and last strictly later closes, requiring at least two. Neither is a causal news effect, abnormal return, calibrated signal or the full-window momentum. No intraday timing or complete trading calendar is available.",
    patternAssessment: { status: "unassessed" as const, rule: null,
      reason: "No prespecified price-pattern rule or comparison baseline was evaluated; these closes support only the listed observed returns. Do not assign a named pattern to this window, even as a hypothesis." },
    windows: news.articles.map(article => {
      const before = closes.findLast(close => close.date < article.marketDate) ?? null;
      const after = closes.filter(close => close.date > article.marketDate);
      const firstAfter = after[0] ?? null, lastAfter = after.at(-1) ?? null;
      return { articleId: article.id, publishedAt: article.publishedAt, marketDate: article.marketDate,
        before, firstAfter, lastAfter, afterDates: after.map(close => close.date),
        aroundPublicationReturn: priceReturn(before, firstAfter),
        subsequentReturn: priceReturn(firstAfter, lastAfter) };
    }),
  };
}
