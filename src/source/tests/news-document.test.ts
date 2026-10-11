import { expect, it } from "bun:test";
import { extractNewsDocument, readNewsDocument } from "../src/news-document.ts";
import type { NewsArticle } from "../../types/news.ts";

const url = "https://finance.yahoo.com/news/company-123.html";
const article: NewsArticle = { id: "observed-article", title: "Company raises guidance", publishedAt: "2026-09-08T12:00:00Z",
  marketDate: "2026-09-08", relevance: "provider-tag", origins: [{ provider: "yahoo", endpoint: "news-search", publisher: "Fixture News", url,
    publishedAt: "2026-09-08T12:00:00Z", providerId: "fixture" }] };
const paragraph = "The company reported increased revenue, while management warned that demand could weaken. These statements describe a fictional report for testing extraction and do not establish an investment conclusion.";
function html(title = article.title, text = paragraph, extra = "") {
  return `<html><head><title>${title}</title><meta property="og:title" content="${title}"></head><body>${extra}<article><h1>${title}</h1><p>${text}</p><p>${paragraph}</p></article></body></html>`;
}
const extract = (page: string) => extractNewsDocument(article, page, url, url, "2026-09-14T12:00:00Z");
function responseFetch(response: Response): typeof fetch {
  return (async (_input, _init) => response) as typeof fetch;
}

it("extracts numbered plain paragraphs with stable content references without executing scripts", () => {
  const result = extract(html(article.title, `<b>${paragraph}</b>`, '<script>throw new Error("must not execute")</script><nav>Navigation only</nav>'));
  expect(result.status).toBe("available"); expect(result.title).toBe(article.title);
  expect(result.paragraphs[0]).toEqual({ id: "p1", text: paragraph });
  expect(JSON.stringify(result.paragraphs)).not.toMatch(/<b>|script|Navigation only/);
  expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(extract(html()).contentHash).toBe(result.contentHash);
  expect(extract(html(article.title, paragraph + " Changed claim.")).contentHash).not.toBe(result.contentHash);
});

it("rejects a changed article title and short or empty page instead of substituting a headline", () => {
  const changed = extract(html("A different report"));
  expect(changed.status).toBe("title-mismatch"); expect(changed.paragraphs).toEqual([]); expect(changed.contentHash).toBeNull();
  expect(extract(`<html><head><title>${article.title}</title></head><body><p>Too short.</p></body></html>`).status).toBe("empty");
  expect(extract("").paragraphs).toEqual([]);
});

it.each([
  '<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","isAccessibleForFree":false}]}</script>',
  '<script type="application/ld+json">{"@type":["Article"],"isAccessibleForFree":"false"}</script>',
  '<div data-testid="paywall">Subscribers only</div>',
])("retains an explicit restricted status for publisher access markers", marker => {
  const result = extract(html(article.title, paragraph, marker));
  expect(result.status).toBe("restricted"); expect(result.paragraphs).toEqual([]); expect(result.contentHash).toBeNull();
});

it("reports character truncation and rejects oversized HTML", () => {
  const result = extract(html(article.title, paragraph.repeat(80)));
  expect(result.status).toBe("truncated"); expect(result.retainedCharacters).toBe(12_000);
  expect(result.extractedCharacters).toBeGreaterThan(result.retainedCharacters);
  expect(extract("x".repeat(2 * 1024 * 1024 + 1)).status).toBe("unavailable");
});

it("recognizes only Eastmoney's observed site suffix while preserving the original page title", () => {
  const title = "银行公司发布业绩公告", observed = `${title} _ 东方财富网`, eastmoney = "https://finance.eastmoney.com/a/fixture.html";
  const result = extractNewsDocument({ ...article, title }, html(observed), eastmoney, eastmoney, "2026-09-14T12:00:00Z");
  expect(result.status).toBe("available"); expect(result.title).toBe(observed);
  expect(extractNewsDocument({ ...article, title: "不同公告" }, html(observed), eastmoney, eastmoney, result.fetchedAt).status).toBe("title-mismatch");
  expect(extractNewsDocument({ ...article, title }, html(observed), url, url, result.fetchedAt).status).toBe("title-mismatch");
});

it.each(["https://example.com/story", "http://127.0.0.1/story", "https://finance.yahoo.com:444/story", "https://secret@finance.yahoo.com/story"])("does not fetch unsupported article URL %s", async unsupported => {
  let calls = 0;
  const result = await readNewsDocument({ ...article, origins: [{ ...article.origins[0]!, url: unsupported }] }, {
    fetch: (async (_input, _init) => { calls++; return new Response(""); }) as typeof fetch });
  expect(calls).toBe(0); expect(result.status).toBe("unsupported");
});

it("follows bounded public-host redirects with no credentials and preserves both URLs", async () => {
  const calls: string[] = [];
  const result = await readNewsDocument(article, { fetch: (async (input, init) => {
    calls.push(String(input)); expect(init?.credentials).toBe("omit"); expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual({ accept: "text/html" });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "/news/updated.html" } })
      : new Response(html(), { headers: { "content-type": "text/html; charset=utf-8" } });
  }) as typeof fetch });
  expect(calls).toEqual([url, "https://finance.yahoo.com/news/updated.html"]);
  expect(result).toMatchObject({ status: "available", requestedUrl: url, finalUrl: calls[1] });
});

it("stops external redirects and redirect loops", async () => {
  expect((await readNewsDocument(article, { fetch: responseFetch(new Response(null, { status: 302, headers: { location: "https://login.yahoo.com/" } })) })).status).toBe("restricted");
  let calls = 0;
  const result = await readNewsDocument(article, { fetch: (async (_input, _init) => { calls++; return new Response(null, { status: 302, headers: { location: url } }); }) as typeof fetch });
  expect(calls).toBe(4); expect(result.status).toBe("unavailable"); expect(result.reason).toContain("redirect limit");
});

it.each([401, 403, 429, 500])("preserves HTTP %s failures without extracting error pages", async status => {
  const result = await readNewsDocument(article, { fetch: responseFetch(new Response(html(), { status })) });
  expect(result.status).toBe(status === 401 || status === 403 ? "restricted" : "unavailable");
  expect(result.reason).toContain(String(status)); expect(result.paragraphs).toEqual([]);
});

it("rejects non-HTML, content-length overflow and streamed overflow", async () => {
  for (const response of [new Response("{}", { headers: { "content-type": "application/json" } }),
    new Response("x", { headers: { "content-type": "text/html", "content-length": "3000000" } }),
    new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "text/html" } })]) {
    const result = await readNewsDocument(article, { fetch: responseFetch(response) });
    expect(result.status).toBe("unavailable"); expect(result.paragraphs).toEqual([]);
  }
});

it("cancels a stalled body on timeout and propagates explicit user cancellation", async () => {
  let cancelled = 0;
  const stalled = () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }), { headers: { "content-type": "text/html" } });
  const timed = await readNewsDocument(article, { timeoutMs: 20, fetch: responseFetch(stalled()) });
  expect(timed.status).toBe("unavailable"); expect(timed.reason).toContain("timed out"); expect(cancelled).toBe(1);
  const controller = new AbortController();
  const pending = readNewsDocument(article, { signal: controller.signal, fetch: responseFetch(stalled()) });
  await Bun.sleep(5); controller.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled"); expect(cancelled).toBe(2);
  let calls = 0;
  await expect(readNewsDocument(article, { signal: controller.signal,
    fetch: (async (_input, _init) => { calls++; return new Response(""); }) as typeof fetch })).rejects.toThrow("cancelled");
  expect(calls).toBe(0);
});
