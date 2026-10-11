import type { Market } from "../types/data.ts";

export interface MarketSymbol {
  code: string;
  name?: string;
}

export function baseCode(symbol: string): string {
  const text = symbol.trim();
  return text.replace(/\.(SH|SZ|BJ|OF|HK)$/i, "");
}

export function isMarketSymbol(symbol: string): boolean {
  return /^(?:\d{6}(?:\.(?:SH|SZ|BJ|OF))?|\d{4,5}\.HK|[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*)$/i.test(symbol);
}

/** Keep exchange and instrument identity intact across provider and cache keys. */
export function normalizeSymbol(symbol: string, market: Market = inferMarket(symbol)): string {
  const text = symbol.trim().toUpperCase();
  if (!isMarketSymbol(text)) throw new Error(`Invalid market symbol: ${symbol}`);
  const normalized = market !== "A" || !/^\d{6}$/.test(text) ? text
    : /^[56]/.test(text) ? `${text}.SH` : /^[48]/.test(text) ? `${text}.BJ` : `${text}.SZ`;
  if (inferMarket(normalized) !== market) throw new Error(`Symbol ${normalized} does not match market ${market}.`);
  return normalized;
}

export function inferMarket(symbol: string): Market {
  const text = symbol.trim();
  if (/\.HK$/i.test(text)) return "HK";
  if (/^[A-Z][A-Z0-9.-]*$/i.test(text) && !/^\d{6}/.test(text)) return "US";
  return "A";
}

export function isAIndexSymbol(symbol: string): boolean {
  return /^(?:000\d{3}\.SH|399\d{3}(?:\.SZ)?|000300)$/i.test(symbol.trim());
}
