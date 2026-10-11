import { getJson, postJson } from "./http.ts";
import { runPython } from "./akshare-python.ts";
import type { NewsProvider, NewsEndpoint } from "../../types/news.ts";

export type NewsTransport = (provider: NewsProvider, query: string, signal?: AbortSignal, endpoint?: NewsEndpoint) => Promise<unknown>;

/** The two-field quote is optional metadata; news remains usable if it fails. */
export async function fetchEastmoneySubjectQuote(code: string, signal?: AbortSignal): Promise<unknown | null> {
  if (!/^[036]\d{5}$/.test(code)) return null;
  const market = code.startsWith("6") ? "1" : "0";
  const url = new URL("https://push2.eastmoney.com/api/qt/stock/get");
  url.searchParams.set("secid", `${market}.${code}`);
  url.searchParams.set("fields", "f57,f58");
  try {
    const payload = await getJson<unknown>(url.href, {}, { signal, timeoutMs: 6_000 });
    return payload && typeof payload === "object" && "data" in payload ? payload.data : null;
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

/** Search transport only; no arbitrary URLs, cookies, account keys or page execution. */
export const fetchNewsRows: NewsTransport = async (provider, query, signal, endpoint) => {
  signal?.throwIfAborted();
  if (endpoint === "ticker-news") {
    if (provider !== "yahoo") throw new Error("Ticker news requires Yahoo");
    // yfinance Ticker.get_news uses this symbol-bound stream, distinct from generic search.
    const payload = await postJson<unknown>("https://finance.yahoo.com/xhr/ncp?queryRef=latestNews&serviceKey=ncp_fin",
      { serviceConfig: { snippetCount: 30, s: [query] } }, {}, { signal });
    const data = payload && typeof payload === "object" && "data" in payload ? payload.data : null;
    const ticker = data && typeof data === "object" && "tickerStream" in data ? data.tickerStream : null;
    if (!ticker || typeof ticker !== "object" || !("stream" in ticker) || !Array.isArray(ticker.stream)) throw new Error("Invalid Yahoo ticker news response");
    return ticker.stream;
  }
  if (provider === "yahoo") {
    // Parameters follow yfinance Search. This public endpoint has no availability SLA.
    const url = new URL("https://query2.finance.yahoo.com/v1/finance/search");
    for (const [key, value] of Object.entries({ q: query, quotesCount: "1", newsCount: "30", enableFuzzyQuery: "false", newsQueryId: "news_cie_vespa" })) url.searchParams.set(key, value);
    const payload = await getJson<unknown>(url.href, {}, { signal });
    if (!payload || typeof payload !== "object" || !("news" in payload) || !Array.isArray(payload.news)) throw new Error("Invalid Yahoo news response");
    const quotes = (payload as Record<string, unknown>).quotes;
    return { rows: payload.news, quotes: Array.isArray(quotes) ? quotes : [] };
  }
  const quotePromise = fetchEastmoneySubjectQuote(query, signal);
  const newsPromise = runPython([
    "import sys, json",
    "import akshare as ak",
    "rows = ak.stock_news_em(symbol=sys.argv[1])",
    "print(rows.head(100).to_json(orient='records', force_ascii=False))",
  ].join("\n"), [query], { signal, timeoutMs: 20_000 });
  const [{ stdout }, quote] = await Promise.all([newsPromise, quotePromise]);
  signal?.throwIfAborted();
  return { rows: JSON.parse(stdout.trim()), quote };
};
