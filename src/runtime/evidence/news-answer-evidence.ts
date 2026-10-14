import { isDeepStrictEqual } from "node:util";
import { isPriceAdjustment } from "../../market/price-adjustment.ts";
import { record } from "../../research/references.ts";
import { auditNewsAnswerCitations, newsAnswerCitationKeys } from "../../research/news-citations.ts";
import type { ResearchState } from "../../research/state.ts";
import { normalizeNewsScope } from "../../source/index.ts";
import { knownNewsPriceBasisViolations } from "./news-answer-claims.ts";

/** Compare explicit basis claims with one recorded news scope, not independently verified publisher facts. */
export function auditCurrentNewsAnswer(state: ResearchState, text: string): {
  status: "not-news" | "unavailable" | "audited"; violations: string[];
} {
  const news = state.operations.filter(operation => operation.tool === "research_news");
  if (!news.length) return { status: "not-news", violations: [] };
  const cited = newsAnswerCitationKeys(text);
  const currentRequest = state.requests.at(-1)?.entryId;
  let selected = currentRequest ? news.filter(operation => operation.requestEntryId === currentRequest) : [];
  if (!selected.length) {
    if (!cited.length) return { status: "not-news", violations: [] };
    selected = news.filter(operation => {
      const citations = operation.recordedScope?.citations;
      return Array.isArray(citations) && cited.every(id => citations.some(item => record(item)?.id === id));
    });
    if (selected.length !== 1) return { status: "unavailable", violations: [] };
  } else if (selected.some(operation => !isDeepStrictEqual(operation.parameters, selected[0]!.parameters))) {
    return { status: "unavailable", violations: [] };
  }
  const operation = selected.at(-1)!;
  const scope = operation.recordedScope;
  if (!operation.resultEntryId || !scope || !["recorded", "unverified"].includes(operation.status))
    return { status: "unavailable", violations: [] };
  const citations = scope.citations;
  if (cited.length && (!Array.isArray(citations)
    || !cited.every(id => citations.some(item => record(item)?.id === id))))
    return { status: "unavailable", violations: [] };
  const { symbol, market, start, end } = operation.parameters;
  if (typeof symbol !== "string" || typeof start !== "string" || typeof end !== "string"
    || market !== "A" && market !== "US" && market !== "HK") return { status: "unavailable", violations: [] };
  try {
    const normalized = normalizeNewsScope({ symbol, market, start, end });
    if (scope.symbol !== normalized.symbol || scope.market !== normalized.market || scope.start !== start || scope.end !== end)
      return { status: "unavailable", violations: [] };
  } catch { return { status: "unavailable", violations: [] }; }
  const citationAudit = cited.length ? auditNewsAnswerCitations(text, scope) : null;
  if (citationAudit?.status === "unavailable") return { status: "unavailable", violations: [] };
  const violations = citationAudit?.violations ?? [];
  const price = record(scope.price), dataset = record(price?.dataset);
  if (!price || !["available", "insufficient", "unavailable"].includes(String(price.status)))
    return { status: "unavailable", violations: [] };
  if (price.status === "unavailable" || !dataset)
    return { status: "audited", violations: [...violations, ...knownNewsPriceBasisViolations(text, null)] };
  const requested = record(dataset.requested);
  if (dataset.version !== 1 || dataset.kind !== "daily-bars" || dataset.symbol !== scope.symbol || dataset.market !== scope.market
    || requested?.start !== start || requested?.end !== end || !isPriceAdjustment(dataset.adjustment))
    return { status: "unavailable", violations: [] };
  return { status: "audited", violations: [...violations, ...knownNewsPriceBasisViolations(text, dataset.adjustment)] };
}
