import { isAIndexSymbol } from "../../market/symbols.ts";
import type { Bar, SymbolInfo, PriceAdjustment } from "../../types/data.ts";
import { postJson } from "./http.ts";

export const DEFAULT_TUSHARE_BASE_URL = "https://api.tushare.pro";

export interface TushareOptions {
  signal?: AbortSignal;
  token?: string;
  baseUrl?: string;
  env?: Record<string, string | undefined>;
}

interface TushareResponse<T> {
  code: number;
  msg?: string;
  data?: {
    fields: string[];
    items: T[];
  };
}

type TusharePrimitive = string | number | null;

function token(options: TushareOptions = {}): string {
  const env = options.env ?? process.env;
  const value = options.token || env.WHYJ_QUANT_TUSHARE_TOKEN;
  if (!value) throw new Error("WHYJ_QUANT_TUSHARE_TOKEN is not configured");
  return value;
}

async function callTushare<T extends TusharePrimitive[]>(
  apiName: string,
  params: Record<string, unknown>,
  fields: string[],
  options: TushareOptions = {},
): Promise<Array<Record<string, TusharePrimitive>>> {
  const result = await postJson<TushareResponse<T>>(options.baseUrl || options.env?.TUSHARE_BASE_URL || process.env.TUSHARE_BASE_URL || DEFAULT_TUSHARE_BASE_URL, {
    api_name: apiName,
    token: token(options),
    params,
    fields: fields.join(","),
  }, {}, { signal: options.signal });
  if (result.code !== 0) {
    throw new Error(result.msg || `${apiName} failed`);
  }
  const resultFields = result.data?.fields || fields;
  const items = result.data?.items || [];
  return items.map((row) => Object.fromEntries(resultFields.map((field, index) => [field, row[index] ?? null])));
}

function formatDate(d: string): string {
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

function assertResponseSymbol(rows: Array<Record<string, TusharePrimitive>>, symbol: string): void {
  if (rows.some(row => typeof row.ts_code !== "string" || row.ts_code.toUpperCase() !== symbol.toUpperCase())) {
    throw new Error("Tushare response identity mismatch");
  }
}

function barsEndpoint(symbol: string): "fund_nav" | "index_daily" | "fund_daily" | "daily" {
  return /\.OF$/i.test(symbol) ? "fund_nav" : isAIndexSymbol(symbol) ? "index_daily"
    : /^(?:5\d{5}\.SH|1[56]\d{4}\.SZ)$/i.test(symbol) ? "fund_daily" : "daily";
}

export async function fetchFromTushareDetailed(symbol: string, start?: string, end?: string, options: TushareOptions = {}) {
  const endpoint = barsEndpoint(symbol);
  const bars = await fetchFromTushare(symbol, start, end, options);
  const adjustment: PriceAdjustment = endpoint === "fund_nav" ? "unit-nav" : endpoint === "index_daily" ? "index-level" : "unadjusted";
  return { bars, endpoint, adjustment };
}

export async function fetchFromTushare(symbol: string, start?: string, end?: string, options: TushareOptions = {}): Promise<Bar[]> {
  const dateParams = {
    ...(start ? { start_date: start.replace(/-/g, "") } : {}),
    ...(end ? { end_date: end.replace(/-/g, "") } : {}),
  };

  const endpoint = barsEndpoint(symbol);
  if (endpoint === "fund_nav") {
    const rows = await callTushare("fund_nav", { ts_code: symbol, ...dateParams }, ["ts_code", "nav_date", "unit_nav", "adj_nav"], options);
    assertResponseSymbol(rows, symbol);
    return rows.map(row => {
      const close = Number(row.unit_nav);
      return { date: formatDate(String(row.nav_date || "")), open: close, high: close, low: close, close,
        volume: 0, amount: null, ...(row.adj_nav != null ? { adjClose: Number(row.adj_nav) } : {}),
      };
    });
  }
  const rows = await callTushare(endpoint, { ts_code: symbol, ...dateParams }, DAILY_FIELDS, options);
  assertResponseSymbol(rows, symbol);

  return rows.map((row) => ({
    date: formatDate(String(row.trade_date || "")),
    open: Number(row.open || 0),
    high: Number(row.high || 0),
    low: Number(row.low || 0),
    close: Number(row.close || 0),
    volume: Number(row.vol || 0),
    amount: row.amount == null ? null : Number(row.amount),
  }));
}

const DAILY_FIELDS = ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"];

export async function searchTushareSymbols(keyword: string, options: TushareOptions = {}): Promise<SymbolInfo[]> {
  const rows = await callTushare(
    "stock_basic",
    { name: keyword, list_status: "L" },
    ["ts_code", "name", "area", "industry", "market", "list_date"],
    options,
  );
  return rows.map((row) => ({
    code: String(row.ts_code || ""),
    name: String(row.name || row.ts_code || ""),
    market: "A",
    exchange: String(row.ts_code || "").endsWith(".SH") ? "SSE" : "SZSE",
    type: "stock",
    listDate: String(row.list_date || ""),
  }));
}

export async function fetchTushareSnapshot(symbol: string, options: TushareOptions = {}): Promise<Record<string, unknown>> {
  const rows = await callTushare(
    "daily_basic",
    { ts_code: symbol },
    ["ts_code", "trade_date", "close", "pe", "pe_ttm", "pb", "total_mv", "circ_mv"],
    options,
  );
  assertResponseSymbol(rows, symbol);
  return rows[0] || {};
}
