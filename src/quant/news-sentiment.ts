import type { NewsSnapshot } from "../types/news.ts";

export type NewsTone = "positive" | "negative" | "mixed" | "unknown";
const POSITIVE = /\bbeats? (?:earnings )?estimates\b|\braises? guidance\b|\bupgraded\b|\brecord profits?\b|净利润增长|利润增长|上调评级|扭亏为盈/gi;
const NEGATIVE = /\bmisses? (?:earnings )?estimates\b|\bcuts? guidance\b|\bdowngraded\b|\bprofit warning\b|净利润下降|下调评级|亏损扩大|债务违约/gi;
// Screen the whole title conservatively; qualifiers can concern only one clause, so retain raw hits for review.
const UNCERTAIN = /\b[a-z]+n['’]t\b|\b(?:not|no|never|cannot|without|denies|denied|disputes?|may|could|might|would|if|unless|expected|reportedly|rumou?r)\b|否认|未经|并未|不会|未(?:上调|下调|出现|实现|发生|被|曾|能|有)|没有|并非|并不|不(?:上调|下调|是|属实)|如果|若|假如|除非|可能|传闻|预计|有望|[?？]/i;

/** A reproducible title triage, not a calibrated return predictor or full-article sentiment model. */
export function newsSentiment(snapshot: NewsSnapshot, targetArticleIds?: ReadonlySet<string>, withheldArticleIds?: ReadonlySet<string>) {
  const items = snapshot.articles.map(article => {
    const headlineWithheld = withheldArticleIds?.has(article.id) ?? false;
    const positive = headlineWithheld ? [] : [...article.title.matchAll(POSITIVE)].map(match => match[0]);
    const negative = headlineWithheld ? [] : [...article.title.matchAll(NEGATIVE)].map(match => match[0]);
    const uncertain = UNCERTAIN.test(article.title);
    const tone: NewsTone = uncertain || !positive.length && !negative.length ? "unknown"
      : positive.length && negative.length ? "mixed" : positive.length ? "positive" : "negative";
    return { id: article.id, tone, positive, negative, headlineWithheld, includedInTargetTone: !targetArticleIds || targetArticleIds.has(article.id),
      uncertainty: headlineWithheld ? "Instruction-like headline excluded from title triage; no directional financial claim is inferred."
      : uncertain ? "Negation, speculation, condition or question detected; manual review required."
      : tone === "unknown" ? "No supported directional phrase; unknown does not mean neutral."
        : "Title phrase only; verify the subject, event and original article before interpreting impact." };
  });
  const counts = { positive: 0, negative: 0, mixed: 0, unknown: 0 }, candidateCounts = { ...counts };
  for (const item of items) { candidateCounts[item.tone]++; if (item.includedInTargetTone) counts[item.tone]++; }
  const tone: NewsTone = counts.mixed || counts.positive && counts.negative ? "mixed" : counts.positive ? "positive" : counts.negative ? "negative" : "unknown";
  return { method: "headline-phrases-v2" as const, basis: "title-only" as const, confidence: "low" as const,
    scope: targetArticleIds ? "headline-subject-candidates-v1" as const : "all-candidates" as const,
    probabilityInterval: null, calibration: "No labeled calibration set; no numeric sentiment score or probability is estimated.",
    tone, counts, candidateCounts, items };
}
