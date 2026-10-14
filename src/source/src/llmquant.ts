import { normalizeBarSeries, validateDateRange } from "../../market/bars.ts";
import type { Bar } from "../../types/data.ts";
import { getJson } from "./http.ts";
import { assertDeclaredTicker } from "./provider-identity.ts";
import { mapProviderPriceRow } from "./provider-price-row.ts";

const DEFAULT_LLMQUANT_BASE_URL = "https://api.llmquantdata.com";
const LLMQUANT_MAX_WINDOW_REQUESTS = 128;
const DAY_MS = 86_400_000;

export interface LlmQuantOptions {
  signal?: AbortSignal;
  apiKey?: string;
  baseUrl?: string;
  env?: Record<string, string | undefined>;
}

function apiKey(options: LlmQuantOptions = {}): string {
  const env = options.env ?? process.env;
  const value = options.apiKey || env.WHYJ_QUANT_LLMQUANT_API_KEY;
  if (!value) throw new Error("WHYJ_QUANT_LLMQUANT_API_KEY is not configured");
  return value;
}

type LlmQuantRow = {
  date?: string;
  time?: string;
  trade_date?: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
  adj_close?: number | string;
  adjusted_close?: number | string;
};

function rowsFromPayload(payload: unknown): LlmQuantRow[] {
  if (Array.isArray(payload)) return payload as LlmQuantRow[];
  if (payload && typeof payload === "object") {
    const data = (payload as { data?: unknown }).data;
    if (data && typeof data === "object" && Array.isArray((data as { prices?: unknown[] }).prices)) {
      return (data as { prices: LlmQuantRow[] }).prices;
    }
    if (Array.isArray(data)) return data as LlmQuantRow[];
  }
  throw new Error("Provider response invalid");
}

export async function fetchFromLlmQuant(symbol: string, start?: string, end?: string, options: LlmQuantOptions = {}): Promise<Bar[]> {
  validateDateRange(start, end);
  const baseUrl = options.baseUrl || options.env?.LLMQUANT_BASE_URL || process.env.LLMQUANT_BASE_URL || DEFAULT_LLMQUANT_BASE_URL;
  const headers = { authorization: `Bearer ${apiKey(options)}` };
  const pending: Array<{ start?: string; end?: string }> = [{ start, end }];
  const bars: Bar[] = [];
  let requests = 0;
  while (pending.length) {
    options.signal?.throwIfAborted();
    if (requests >= LLMQUANT_MAX_WINDOW_REQUESTS) throw new Error("Provider response truncated");
    const window = pending.pop()!;
    requests += 1;
    const query = new URLSearchParams({
      ticker: symbol,
      limit: start || end ? "200" : "30",
      ...(window.start ? { start_date: window.start } : {}),
      ...(window.end ? { end_date: window.end } : {}),
    });
    const payload = await getJson<unknown>(`${baseUrl}/api/equity/historical?${query.toString()}`, headers, { signal: options.signal });
    let notice: unknown;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const wrapper = payload as { ticker?: unknown; data?: unknown; meta?: { notice?: unknown } };
      assertDeclaredTicker(wrapper.ticker, symbol);
      if (wrapper.data && typeof wrapper.data === "object" && !Array.isArray(wrapper.data))
        assertDeclaredTicker((wrapper.data as { ticker?: unknown }).ticker, symbol);
      notice = wrapper.meta?.notice;
    }
    if (notice != null && typeof notice !== "string") throw new Error("Provider response invalid");
    if (typeof notice === "string" && notice.trim() && (start || end)) {
      if (!window.start || !window.end || window.start === window.end) throw new Error("Provider response truncated");
      const firstDay = Date.parse(`${window.start}T00:00:00Z`) / DAY_MS;
      const lastDay = Date.parse(`${window.end}T00:00:00Z`) / DAY_MS;
      const middleDay = Math.floor((firstDay + lastDay) / 2);
      const middle = new Date(middleDay * DAY_MS).toISOString().slice(0, 10);
      const next = new Date((middleDay + 1) * DAY_MS).toISOString().slice(0, 10);
      pending.push({ start: next, end: window.end }, { start: window.start, end: middle });
      continue;
    }
    for (const row of rowsFromPayload(payload)) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Provider response invalid");
      assertDeclaredTicker((row as { ticker?: unknown }).ticker, symbol);
      const bar = mapProviderPriceRow(row, row.time ?? row.date ?? row.trade_date, row.adj_close ?? row.adjusted_close);
      if ((window.start && bar.date < window.start) || (window.end && bar.date > window.end))
        throw new Error("Provider response invalid");
      bars.push(bar);
    }
  }
  return normalizeBarSeries(bars, start, end);
}
