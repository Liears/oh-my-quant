import type { Bar } from "../../types/data.ts";
import { getJson } from "./http.ts";

const DEFAULT_FD_BASE_URL = "https://api.financialdatasets.ai";
const FD_RECENT_DAYS = 60;

export interface FinancialDatasetsOptions {
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
  date?: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
};

function rowsFromPayload(payload: unknown): FDPriceRow[] {
  if (Array.isArray(payload)) return payload as FDPriceRow[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { prices?: unknown[] }).prices)) {
    return (payload as { prices: FDPriceRow[] }).prices;
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)) {
    return (payload as { data: FDPriceRow[] }).data;
  }
  return [];
}

export async function fetchFromFinancialDatasets(symbol: string, start?: string, end?: string, options: FinancialDatasetsOptions = {}): Promise<Bar[]> {
  const hasRange = Boolean(start || end);
  const recentEnd = new Date();
  const recentStart = new Date(recentEnd);
  recentStart.setUTCDate(recentStart.getUTCDate() - FD_RECENT_DAYS);
  const query = new URLSearchParams({
    ticker: symbol,
    interval: "day",
    ...(hasRange ? { start_date: start || recentStart.toISOString().slice(0, 10) } : { start_date: recentStart.toISOString().slice(0, 10) }),
    ...(hasRange ? { end_date: end || recentEnd.toISOString().slice(0, 10) } : { end_date: recentEnd.toISOString().slice(0, 10) }),
  });
  const baseUrl = options.baseUrl || options.env?.FINANCIAL_DATASETS_BASE_URL || process.env.FINANCIAL_DATASETS_BASE_URL || DEFAULT_FD_BASE_URL;
  const payload = await getJson<unknown>(`${baseUrl}/prices/?${query.toString()}`, authHeaders(options));
  const rows = rowsFromPayload(payload);
  const mapped = rows.map((row) => ({
    date: String((row as { time?: string; date?: string }).time || row.date || ""),
    open: Number(row.open || 0),
    high: Number(row.high || 0),
    low: Number(row.low || 0),
    close: Number(row.close || 0),
    volume: Number(row.volume || 0),
    amount: 0,
    adjClose: (row as { adjusted_close?: number | string }).adjusted_close != null
      ? Number((row as { adjusted_close?: number | string }).adjusted_close)
      : undefined,
  }));
  return hasRange ? mapped : mapped.slice(-30);
}

export async function fetchFinancialDatasetsSnapshot(symbol: string, options: FinancialDatasetsOptions = {}): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ ticker: symbol });
  const baseUrl = options.baseUrl || options.env?.FINANCIAL_DATASETS_BASE_URL || process.env.FINANCIAL_DATASETS_BASE_URL || DEFAULT_FD_BASE_URL;
  const snapshot = await getJson<Record<string, unknown>>(
    `${baseUrl}/prices/snapshot?${query.toString()}`,
    authHeaders(options),
  );
  return (snapshot.snapshot && typeof snapshot.snapshot === "object") ? snapshot.snapshot as Record<string, unknown> : snapshot;
}
