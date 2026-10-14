import { isDeepStrictEqual } from "node:util";
import { record } from "./references.ts";
import { projectNewsModelView } from "./news-model-view.ts";
import { newsAbsenceClaimViolations } from "./news-absence-claims.ts";

function brackets(text: string): string[] {
  return [...text.matchAll(/\[([^\]\r\n]+)\]/gu)].map(match => match[1]!);
}

/** Keys bind a recorded scope even when the explicit reference itself is malformed. */
export function newsAnswerCitationKeys(text: string): string[] {
  return [...new Set(brackets(text).flatMap(value => {
    const key = value.trim().split("/")[0]!.trim();
    return /^N-[^/\s\[\]]+$/u.test(key) ? [key] : [];
  }))];
}

const DOCUMENT_STATUSES = ["available", "truncated", "unsupported", "restricted", "unavailable", "empty", "title-mismatch"];

/** Validate the raw mapping before deriving citeable model excerpts. This does not authenticate publisher claims. */
function mappedEvidence(value: unknown): { documents: Record<string, unknown>[]; citations: Record<string, unknown>[] } | null {
  const root = record(value);
  if (!Array.isArray(root?.documents) || !Array.isArray(root.citations)) return null;
  const documents = root.documents.map(record), citations = root.citations.map(record);
  if (documents.some(item => !item) || citations.some(item => !item) || documents.length !== citations.length) return null;
  const docs = documents as Record<string, unknown>[], refs = citations as Record<string, unknown>[];
  if (new Set(docs.map(doc => doc.articleId)).size !== docs.length || new Set(refs.map(ref => ref.id)).size !== refs.length) return null;
  for (const doc of docs) {
    if (typeof doc.articleId !== "string" || typeof doc.requestedUrl !== "string"
      || !DOCUMENT_STATUSES.includes(String(doc.status)) || !(doc.contentHash === null || typeof doc.contentHash === "string")
      || !Array.isArray(doc.paragraphs)) return null;
    const paragraphs = doc.paragraphs.map(record);
    if (paragraphs.some(paragraph => !paragraph || typeof paragraph.id !== "string" || !/^p\d+$/u.test(paragraph.id)
      || typeof paragraph.text !== "string")) return null;
    const ids = paragraphs.map(paragraph => paragraph!.id);
    if (new Set(ids).size !== ids.length) return null;
    const ref = refs.find(citation => citation.articleId === doc.articleId);
    if (!ref || typeof ref.id !== "string" || !/^N-[^/\s\[\]]+$/u.test(ref.id)
      || ref.requestedUrl !== doc.requestedUrl || ref.status !== doc.status || ref.contentHash !== doc.contentHash
      || !isDeepStrictEqual(ref.paragraphIds, ids)) return null;
  }
  return { documents: docs, citations: refs };
}

/** Production checks explicit news references; evaluation can additionally require every document. */
export function auditNewsAnswerCitations(text: string, evidence: unknown, options: {
  requireEveryDocument?: boolean; allBracketReferences?: boolean;
} = {}): { status: "available" | "unavailable"; references: string[]; violations: string[] } {
  const tokens = brackets(text);
  const selected = tokens.filter(token => token.trim().startsWith("N-") || options.allBracketReferences && token.includes("/"));
  const references = selected.filter(token => token.includes("/"));
  const mapping = mappedEvidence(evidence);
  if (!mapping) return { status: "unavailable", references, violations: [] };
  const view = projectNewsModelView(mapping);
  const allowed = new Set(view.citations.flatMap(citation => citation.status === "restricted" ? [`${citation.id}/restricted`]
    : (citation.status === "available" || citation.status === "truncated") && citation.contentHash
      ? (citation.paragraphIds as string[]).map(id => `${citation.id}/${id}`) : []));
  const violations = new Set<string>(), cited = new Set<string>();
  for (const token of selected) {
    const match = /^(N-[^/\s\[\]]+)\/(restricted|p\d+(?:,\s*p\d+)*)$/u.exec(token);
    if (!match) { violations.add("malformed-news-citation"); continue; }
    const selectors = match[2]!.split(",").map(selector => selector.trim());
    if (selectors.some(selector => !allowed.has(`${match[1]}/${selector}`))) violations.add("unsupported-news-citation");
    else cited.add(match[1]!);
  }
  if (options.requireEveryDocument && (!mapping.citations.length || mapping.citations.some(citation => !cited.has(citation.id as string))))
    violations.add("missing-news-document-reference");
  const paragraphs = new Map<string, string>();
  for (const citation of view.citations) {
    const doc = view.documents.find(item => item.articleId === citation.articleId);
    for (const value of Array.isArray(doc?.paragraphs) ? doc.paragraphs : []) {
      const paragraph = record(value);
      const key = `${citation.id}/${paragraph?.id}`;
      if (allowed.has(key) && typeof paragraph?.text === "string") paragraphs.set(key, paragraph.text);
    }
  }
  for (const violation of newsAbsenceClaimViolations(text, paragraphs)) violations.add(violation);
  return { status: "available", references, violations: [...violations] };
}
