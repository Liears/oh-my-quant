import type { Market } from "../types/data.ts";

export interface MarketSymbol {
  code: string;
  name?: string;
}

export function baseCode(symbol: string): string {
  const text = symbol.trim();
  return text.split(".")[0] || text;
}

export function inferMarket(symbol: string): Market {
  const text = symbol.trim();
  if (/\.HK$/i.test(text)) return "HK";
  if (/^[A-Z][A-Z0-9.-]*$/i.test(text) && !/^\d{6}/.test(text)) return "US";
  return "A";
}

export function isAIndexSymbol(symbol: string): boolean {
  return /^\d{6}(\.(SH|SZ|BJ))?$/i.test(symbol.trim());
}
