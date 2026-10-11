import { normalizeBarSeries } from "../../market/bars.ts";
import type { Bar } from "../../types/data.ts";
import { getJson } from "./http.ts";
import { assertDeclaredTicker } from "./provider-identity.ts";
import { mapProviderPriceRow } from "./provider-price-row.ts";

const DEFAULT_FD_BASE_URL = "https://api.financialdatasets.ai";
const FD_RECENT_DAYS = 60;
const FD_MAX_PRICE_PAGES = 128;

export interface FinancialDatasetsOptions {
  signal?: AbortSignal;
  apiKey?: string;
  baseUrl?: string;
  env?: Record<string, string | undefined>;
}

function apiKey(options: FinancialDatasetsOptions = {}): string {
  const env = options.env ?? process.env;
  const value = options.apiKey || env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY;
  if (!value) throw new Error("WHYJ_QUANT_FINANCIAL_DATASETS_KEY is not configured");
  return value;
}

function authHeaders(options: FinancialDatasetsOptions = {}): Record<string, string> {
  return { "X-API-KEY": apiKey(options) };
}

type FDPriceRow = {
  time?: string;
  date?: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
  adjusted_close?: number | string;
};

function rowsFromPayload(payload: unknown): FDPriceRow[] {
  if (Array.isArray(payload)) return payload as FDPriceRow[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { prices?: unknown[] }).prices)) {
    return (payload as { prices: FDPriceRow[] }).prices;
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)) {
    return (payload as { data: FDPriceRow[] }).data;
  }
  throw new Error("Provider response invalid");
}

/** The cursor is opaque; validate its destination before forwarding our API key. */
function pricePageUrl(nextPage: unknown, firstUrl: URL): string | null {
  if (nextPage == null || nextPage === "") return null;
  if (typeof nextPage !== "string") throw new Error("Provider pagination invalid");
  let url: URL;
  try { url = new URL(nextPage); }
  catch { throw new Error("Provider pagination invalid"); }
  if (url.origin !== firstUrl.origin || url.pathname.replace(/\/$/, "") !== firstUrl.pathname.replace(/\/$/, "")
    || url.username || url.password || url.hash || url.searchParams.getAll("cursor").length !== 1
    || !url.searchParams.get("cursor")) throw new Error("Provider pagination invalid");
  return url.href;
}

async function fetchPriceRows(firstUrl: string, symbol: string, options: FinancialDatasetsOptions): Promise<FDPriceRow[]> {
  const first = new URL(firstUrl);
  const seen = new Set<string>();
  const rows: FDPriceRow[] = [];
  const headers = authHeaders(options);
  let pageUrl: string | null = first.href;
  while (pageUrl !== null) {
    options.signal?.throwIfAborted();
    if (seen.size >= FD_MAX_PRICE_PAGES) throw new Error("Provider response truncated");
    if (seen.has(pageUrl)) throw new Error("Provider pagination invalid");
    seen.add(pageUrl);
    const payload: unknown = await getJson(pageUrl, headers, { signal: options.signal, redirect: "error" });
    if (payload && typeof payload === "object" && !Array.isArray(payload))
      assertDeclaredTicker((payload as { ticker?: unknown }).ticker, symbol);
    const pageRows = rowsFromPayload(payload);
    for (const row of pageRows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Provider response invalid");
      assertDeclaredTicker((row as { ticker?: unknown }).ticker, symbol);
    }
    rows.push(...pageRows);
    pageUrl = payload && typeof payload === "object" && !Array.isArray(payload)
      ? pricePageUrl((payload as { next_page_url?: unknown }).next_page_url, first) : null;
  }
  return rows;
}

export async function fetchFromFinancialDatasets(symbol: string, start?: string, end?: string, options: FinancialDatasetsOptions = {}): Promise<Bar[]> {
  const hasRange = Boolean(start || end);
  const recentEnd = end ? new Date(`${end}T00:00:00Z`) : new Date();
  const recentStart = new Date(recentEnd);
  recentStart.setUTCDate(recentStart.getUTCDate() - FD_RECENT_DAYS);
  const query = new URLSearchParams({
    ticker: symbol,
    interval: "day",
    start_date: start || recentStart.toISOString().slice(0, 10),
    end_date: end || recentEnd.toISOString().slice(0, 10),
  });
  const baseUrl = options.baseUrl || options.env?.FINANCIAL_DATASETS_BASE_URL || process.env.FINANCIAL_DATASETS_BASE_URL || DEFAULT_FD_BASE_URL;
  const rows = await fetchPriceRows(`${baseUrl}/prices/?${query.toString()}`, symbol, options);
  const mapped = rows.map(row => mapProviderPriceRow(row, row.time ?? row.date, row.adjusted_close));
  const normalized = normalizeBarSeries(mapped, start, end);
  return hasRange ? normalized : normalized.slice(-30);
}

export async function fetchFinancialDatasetsSnapshot(symbol: string, options: FinancialDatasetsOptions = {}): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ ticker: symbol });
  const baseUrl = options.baseUrl || options.env?.FINANCIAL_DATASETS_BASE_URL || process.env.FINANCIAL_DATASETS_BASE_URL || DEFAULT_FD_BASE_URL;
  const snapshot = await getJson<Record<string, unknown>>(
    `${baseUrl}/prices/snapshot?${query.toString()}`,
    authHeaders(options),
    { signal: options.signal },
  );
  assertDeclaredTicker(snapshot.ticker, symbol);
  const result = (snapshot.snapshot && typeof snapshot.snapshot === "object") ? snapshot.snapshot as Record<string, unknown> : snapshot;
  assertDeclaredTicker(result.ticker, symbol);
  return result;
}
