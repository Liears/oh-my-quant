import { validateDateRange } from "../../market/bars.ts";
import { normalizeSymbol } from "../../market/symbols.ts";
import type { Bar, Market } from "../../types/data.ts";
import { getText } from "./http.ts";
import { parseSinaHistoryPayload, SINA_HISTORY_MAX_BYTES } from "./sina-history-payload.ts";
export function sinaHistoryEndpoint(market: Extract<Market, "US" | "HK">): string {
  return market === "US" ? "sina_us_daily_native_free" : "sina_hk_daily_native_free";
}

/** The response contains one encoded string, not executable source. */
export function parseSinaGlobalHistory(symbol: string, market: Extract<Market, "US" | "HK">, text: string, start?: string, end?: string): Bar[] {
  const normalized = normalizeSymbol(symbol, market), code = market === "HK" ? normalized.slice(0, -3) : normalized;
  return parseSinaHistoryPayload(`KLC_K2_${code}`, text, market === "US" ? "unavailable" : "preserve", start, end);
}

export async function fetchSinaGlobalHistory(symbol: string, market: Extract<Market, "US" | "HK">, start?: string, end?: string, signal?: AbortSignal): Promise<Bar[]> {
  const normalized = normalizeSymbol(symbol, market), code = market === "HK" ? normalized.slice(0, -3) : normalized;
  validateDateRange(start, end); signal?.throwIfAborted();
  const url = market === "US" ? `https://finance.sina.com.cn/staticdata/us/${encodeURIComponent(code)}`
    : `https://finance.sina.com.cn/stock/hkstock/${code}/klc2_kl.js`;
  try {
    const text = await getText(url, SINA_HISTORY_MAX_BYTES, { signal, redirect: "error" });
    signal?.throwIfAborted();
    const bars = parseSinaGlobalHistory(normalized, market, text, start, end);
    signal?.throwIfAborted();
    return bars;
  } catch (error) {
    signal?.throwIfAborted();
    const message = error instanceof Error ? error.message : "";
    const http = /^HTTP ([1-5]\d{2})\b/.exec(message);
    throw new Error(http ? `HTTP ${http[1]}` : /timed out/.test(message) ? "Provider request timed out"
      : /^Provider (?:response invalid|response truncated|identity mismatch)$/.test(message) ? message : "Provider connection failed");
  }
}
