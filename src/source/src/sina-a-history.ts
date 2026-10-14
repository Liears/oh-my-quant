import { isDailyDate, normalizeBarSeries, validateDateRange } from "../../market/bars.ts";
import { normalizeSymbol } from "../../market/symbols.ts";
import type { Bar } from "../../types/data.ts";
import { AKSHARE_KNOWN_A_INDEX_SYMBOLS } from "./akshare-endpoints.ts";
import { getText } from "./http.ts";
import { assertSinaCommentTail, parseSinaHistoryPayload, SINA_HISTORY_MAX_BYTES } from "./sina-history-payload.ts";

export function parseSinaQfqFactors(code: string, text: string): Array<{ date: string; factor: number }> {
  if (Buffer.byteLength(text, "utf8") > 1024 * 1024) throw new Error("Provider response truncated");
  const declaration = /^\s*var\s+([A-Za-z_$][\w$]*)\s*=\s*(\{[^\r\n]*?\})(?=[ \t]*(?:;|\/\*|\r?\n|$))[ \t]*;?/.exec(text);
  if (!declaration) throw new Error("Provider response invalid");
  if (declaration[1] !== `${code}qfq`) throw new Error("Provider identity mismatch");
  assertSinaCommentTail(text.slice(declaration[0].length));
  const literal = declaration[2]!;
  let value: unknown;
  try { value = JSON.parse(literal); } catch { throw new Error("Provider response invalid"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provider response invalid");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !Array.isArray(record.data) || !record.data.length || record.data.length > 10_000
    || record.total !== record.data.length || (literal.match(/"total"\s*:/g)?.length ?? 0) !== 1
    || (literal.match(/"data"\s*:/g)?.length ?? 0) !== 1
    || (literal.match(/"d"\s*:/g)?.length ?? 0) !== record.data.length
    || (literal.match(/"f"\s*:/g)?.length ?? 0) !== record.data.length) throw new Error("Provider response invalid");
  let previous = "9999-12-31";
  return record.data.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Provider response invalid");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).length !== 2 || typeof row.d !== "string" || !isDailyDate(row.d) || row.d >= previous
      || typeof row.f !== "string" || !/^\d+(?:\.\d+)?$/.test(row.f)) throw new Error("Provider response invalid");
    previous = row.d;
    const factor = Number(row.f);
    if (!Number.isFinite(factor) || factor <= 0) throw new Error("Provider response invalid");
    return { date: row.d, factor };
  });
}

export async function fetchSinaAHistory(symbol: string, instrument: "stock" | "index", start?: string, end?: string, signal?: AbortSignal): Promise<Bar[]> {
  const normalized = normalizeSymbol(symbol, "A");
  if (!/^\d{6}\.(SH|SZ)$/.test(normalized) || (instrument === "index") !== !!AKSHARE_KNOWN_A_INDEX_SYMBOLS[normalized]) throw new Error("Provider identity mismatch");
  validateDateRange(start, end); signal?.throwIfAborted();
  const code = normalized.slice(-2).toLowerCase() + normalized.slice(0, 6);
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const body = await getText(`https://finance.sina.com.cn/realstock/company/${code}/hisdata/klc_kl.js`, SINA_HISTORY_MAX_BYTES, { signal: combined, redirect: "error" });
    combined.throwIfAborted();
    const bars = parseSinaHistoryPayload(`KLC_KL_${code}`, body, "preserve", start, end);
    combined.throwIfAborted();
    if (instrument === "index" || !bars.length) return bars;
    const factors = parseSinaQfqFactors(code, await getText(`https://finance.sina.com.cn/realstock/company/${code}/qfq.js`, 1024 * 1024, { signal: combined, redirect: "error" }));
    combined.throwIfAborted();
    factors.reverse();
    let at = 0;
    const adjusted = bars.map(bar => {
      while (factors[at + 1] && factors[at + 1]!.date <= bar.date) at++;
      const factor = factors[at];
      if (!factor || factor.date > bar.date) throw new Error("Provider response invalid");
      return { ...bar, open: bar.open / factor.factor, high: bar.high / factor.factor, low: bar.low / factor.factor, close: bar.close / factor.factor };
    });
    if (normalizeBarSeries(adjusted).length !== adjusted.length) throw new Error("Provider response invalid");
    combined.throwIfAborted();
    return adjusted;
  } catch (error) {
    signal?.throwIfAborted();
    const message = error instanceof Error ? error.message : "";
    const http = /^HTTP ([1-5]\d{2})\b/.exec(message);
    throw new Error(controller.signal.aborted || /timed out/.test(message) ? "Provider request timed out" : http ? `HTTP ${http[1]}`
      : /^Provider (?:response invalid|response truncated|identity mismatch)$/.test(message) ? message : "Provider connection failed");
  } finally { clearTimeout(timeout); }
}
