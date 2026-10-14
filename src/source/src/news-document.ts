import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import type { NewsArticle } from "../../types/news.ts";
import type { NewsDocument } from "../../types/news-document.ts";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARACTERS = 12_000;

function pageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port
      || !["finance.yahoo.com", "finance.eastmoney.com"].includes(url.hostname)) return null;
    url.hash = "";
    return url;
  } catch { return null; }
}

function plain(value: string | null | undefined): string {
  return (value ?? "").replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
}

function restrictedArticle(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 12) return false;
  if (Array.isArray(value)) return value.some(item => restrictedArticle(item, depth + 1));
  const object = value as Record<string, unknown>;
  const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  if (types.some(type => typeof type === "string" && /Article|Report|BlogPosting/.test(type))
    && (object.isAccessibleForFree === false || object.isAccessibleForFree === "False" || object.isAccessibleForFree === "false")) return true;
  return Object.values(object).some(item => restrictedArticle(item, depth + 1));
}

/** Uses a non-executing DOM; only plain paragraphs leave this adapter. */
export function extractNewsDocument(article: Pick<NewsArticle, "id" | "title">, html: string, requestedUrl: string, finalUrl: string, fetchedAt: string): NewsDocument {
  const result: NewsDocument = { articleId: article.id, requestedUrl, finalUrl, fetchedAt, method: "readability-0.6.0", status: "empty",
    title: null, byline: null, publishedTime: null, paragraphs: [], contentHash: null, extractedCharacters: 0, retainedCharacters: 0,
    reason: "No reliable article text was extracted; search metadata is not a substitute for the body." };
  if (Buffer.byteLength(html) > MAX_BYTES) return { ...result, status: "unavailable", reason: "Article exceeds the public-page size limit." };
  const { document } = parseHTML(html);
  if (!document.documentElement) return result;
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      if (restrictedArticle(JSON.parse(node.textContent ?? ""))) return { ...result, status: "restricted", reason: "Page marks this article as restricted; no article text is returned." };
    } catch { /* Invalid publisher metadata cannot establish access or article identity. */ }
  }
  if (document.querySelector('[data-testid="paywall"], [data-test="paywall"], #paywall')) return { ...result, status: "restricted", reason: "Page contains an explicit paywall; no article text is returned." };
  const parsed = new Readability(document, { maxElemsToParse: 50_000, charThreshold: 100 }).parse();
  if (!parsed?.content) return result;
  result.title = plain(parsed.title).slice(0, 600) || null;
  result.byline = plain(parsed.byline).slice(0, 300) || null;
  result.publishedTime = plain(parsed.publishedTime).slice(0, 100) || null;
  const identity = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  // Eastmoney appends its site name to article titles; retain the observed title in the result.
  const matchingTitle = pageUrl(finalUrl)?.hostname === "finance.eastmoney.com" ? result.title?.replace(/\s+_\s+东方财富网$/, "") : result.title;
  if (!matchingTitle || identity(matchingTitle) !== identity(article.title)) return { ...result, status: "title-mismatch",
    reason: "The extracted page title differs from the search observation; do not attach this body to the old claim." };
  const body = parseHTML(`<html><body>${parsed.content}</body></html>`).document;
  for (const node of body.querySelectorAll("script,style,noscript,form,nav,footer,aside")) node.remove();
  const paragraphs = [...body.querySelectorAll("p,h2,h3,li,blockquote")]
    .filter(node => !node.parentElement?.closest("p,h2,h3,li,blockquote"))
    .map(node => plain(node.textContent)).filter(Boolean);
  if (!paragraphs.length) return result;
  result.extractedCharacters = paragraphs.reduce((sum, text) => sum + text.length, 0);
  if (result.extractedCharacters < 100) return result;
  for (const text of paragraphs) {
    if (result.paragraphs.length >= 40 || result.retainedCharacters >= MAX_CHARACTERS) break;
    const retained = text.slice(0, MAX_CHARACTERS - result.retainedCharacters);
    result.paragraphs.push({ id: `p${result.paragraphs.length + 1}`, text: retained }); result.retainedCharacters += retained.length;
  }
  result.contentHash = createHash("sha256").update(JSON.stringify({ finalUrl, title: result.title, paragraphs: result.paragraphs })).digest("hex");
  result.status = result.retainedCharacters < result.extractedCharacters ? "truncated" : "available";
  result.reason = "Plain text extracted at fetchedAt, not a historical page version; extraction can omit source material. Cite articleId/contentHash/paragraph IDs; publisher claims and semantic judgments remain unverified.";
  return result;
}

/** No cookies/authentication, arbitrary hosts, page scripts or subresource requests. */
export async function readNewsDocument(article: NewsArticle, options: { signal?: AbortSignal; timeoutMs?: number; fetch?: typeof fetch } = {}): Promise<NewsDocument> {
  options.signal?.throwIfAborted();
  const origin = article.origins.find(item => pageUrl(item.url));
  const result: NewsDocument = { articleId: article.id, requestedUrl: origin?.url ?? article.origins[0]?.url ?? "", finalUrl: null,
    fetchedAt: new Date().toISOString(), method: "readability-0.6.0", status: "unsupported", title: null, byline: null, publishedTime: null,
    paragraphs: [], contentHash: null, extractedCharacters: 0, retainedCharacters: 0,
    reason: "Automatic article reading supports finance.yahoo.com and finance.eastmoney.com only." };
  if (!origin) return result;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    let url = pageUrl(origin.url)!;
    for (let redirects = 0; redirects <= 3; redirects++) {
      signal.throwIfAborted();
      const response = await (options.fetch ?? fetch)(url.href, { signal, redirect: "manual", credentials: "omit", headers: { accept: "text/html" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location"); await response.body?.cancel();
        const next = location ? pageUrl(new URL(location, url).href) : null;
        if (!next) return { ...result, status: "restricted", reason: "Article redirects outside the supported public news hosts; no login or consent bypass attempted." };
        url = next; continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { ...result, status: response.status === 401 || response.status === 403 ? "restricted" : "unavailable", reason: `Article request returned HTTP ${response.status}.` };
      }
      if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") ?? "") || !response.body) {
        await response.body?.cancel(); return { ...result, status: "unavailable", reason: "Article response is not an HTML page." };
      }
      if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body.cancel(); return { ...result, status: "unavailable", reason: "Article exceeds the public-page size limit." }; }
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      const cancel = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener("abort", cancel, { once: true });
      let size = 0;
      try {
        while (true) {
          signal.throwIfAborted(); const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BYTES) throw new Error("Oversized news document");
          chunks.push(chunk.value);
        }
      } finally { signal.removeEventListener("abort", cancel); await reader.cancel(); reader.releaseLock(); }
      signal.throwIfAborted();
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const charset = /charset=\s*["']?([a-z0-9-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1] ?? "utf-8";
      const parsed = extractNewsDocument(article, new TextDecoder(charset).decode(bytes), origin.url, url.href, new Date().toISOString());
      signal.throwIfAborted(); return parsed;
    }
    return { ...result, status: "unavailable", reason: "Article exceeded the redirect limit." };
  } catch {
    options.signal?.throwIfAborted();
    return { ...result, status: "unavailable", reason: controller.signal.aborted ? "Article request timed out." : "Article could not be fetched or parsed within its limits." };
  } finally { clearTimeout(timer); }
}
