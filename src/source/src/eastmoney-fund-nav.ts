import { normalizeFundSymbol } from "../../market/fund-nav.ts";
import type { FundNavDaily } from "../../types/data.ts";
import type { AkshareAttempt } from "./akshare-types.ts";
import { getText } from "./http.ts";

export const EASTMONEY_FUND_NAV_ENDPOINT = "eastmoney_fund_net_worth";
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 100_000;
const FIELDS = new Set(["fS_code", "Data_netWorthTrend", "Data_ACWorthTrend"]);
const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });

export function isFundNativeRuntimeBlocked(attempts: AkshareAttempt[]): boolean {
  return attempts.length > 0 && attempts.every(item => item.status === "error" && /\bWinError\s+4551\b/i.test(item.error ?? ""));
}

/** Read published literals only. Never evaluate the upstream JavaScript. */
export function parseEastmoneyFundNav(symbol: string, text: string): FundNavDaily[] {
  const code = normalizeFundSymbol(symbol).slice(0, 6);
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("Provider response truncated");
  const fields = literalDeclarations(text);
  if (fields.get("fS_code") !== code) throw new Error("Provider identity mismatch");
  const units = fields.get("Data_netWorthTrend"), accumulated = fields.get("Data_ACWorthTrend");
  if (!Array.isArray(units) || units.length > MAX_ROWS || (accumulated !== undefined && (!Array.isArray(accumulated) || accumulated.length > MAX_ROWS))) invalid();
  const accumulatedByDate = new Map<string, number>();
  for (const item of accumulated === undefined ? [] : accumulated as unknown[]) {
    if (!Array.isArray(item) || item.length !== 2 || !positive(item[1])) invalid();
    const date = navDate(item[0]);
    if (accumulatedByDate.has(date)) invalid();
    accumulatedByDate.set(date, item[1]);
  }
  const dates = new Set<string>();
  const nav = (units as unknown[]).map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid();
    const row = item as Record<string, unknown>;
    if (!positive(row.y) || (row.equityReturn != null && (typeof row.equityReturn !== "number" || !Number.isFinite(row.equityReturn)))) invalid();
    const date = navDate(row.x);
    if (dates.has(date)) invalid();
    dates.add(date);
    return { fundCode: code, navDate: date, unitNav: row.y as number,
      accumulatedNav: accumulatedByDate.get(date) ?? null, dailyReturnPct: row.equityReturn as number | null | undefined ?? null,
      // A published NAV observation does not prove subscription/redemption availability.
      isOpenDay: false, source: "akshare" };
  });
  return nav.sort((a, b) => a.navDate.localeCompare(b.navDate));
}

export async function fetchEastmoneyFundNav(symbol: string, externalSignal?: AbortSignal): Promise<FundNavDaily[]> {
  const code = normalizeFundSymbol(symbol).slice(0, 6);
  externalSignal?.throwIfAborted();
  try {
    const text = await getText(`https://fund.eastmoney.com/pingzhongdata/${code}.js`, MAX_BYTES, { signal: externalSignal, redirect: "error" });
    externalSignal?.throwIfAborted();
    return parseEastmoneyFundNav(code, text);
  } catch (error) {
    externalSignal?.throwIfAborted();
    // Never expose URLs, response bodies or arbitrary transport exceptions.
    const message = error instanceof Error ? error.message : "";
    const http = /^HTTP ([1-5]\d{2})\b/.exec(message);
    throw new Error(http ? `HTTP ${http[1]}` : /timed out/.test(message) ? "Provider request timed out"
      : /^Provider (?:response invalid|response truncated|identity mismatch)$/.test(message) ? message : "Provider connection failed");
  }
}

function positive(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0; }
function navDate(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) invalid();
  const date = dateFormat.format(new Date(value as number));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid();
  return date;
}
function invalid(): never { throw new Error("Provider response invalid"); }

/** Restricted declaration file: comments + var assignments, with strict JSON for NAV fields.
 * Reject expressions/reassignments and duplicates; quoted/commented declarations are never scanned as code.
 */
function literalDeclarations(text: string): Map<string, unknown> {
  const fields = new Map<string, unknown>();
  let cursor = 0;
  const skip = () => {
    while (cursor < text.length) {
      if (/\s/.test(text[cursor]!)) { cursor++; continue; }
      if (text.startsWith("//", cursor)) { const end = text.indexOf("\n", cursor + 2); cursor = end < 0 ? text.length : end + 1; continue; }
      if (text.startsWith("/*", cursor)) { const end = text.indexOf("*/", cursor + 2); if (end < 0) invalid(); cursor = end + 2; continue; }
      break;
    }
  };
  while (cursor < text.length) {
    skip();
    if (cursor === text.length) break;
    const declaration = /^var\s+([A-Za-z_$][\w$]*)\s*=\s*/.exec(text.slice(cursor));
    if (!declaration) invalid();
    const name = declaration[1]!;
    cursor += declaration[0].length;
    const start = cursor, stack: string[] = [];
    let quote = "";
    for (; cursor < text.length; cursor++) {
      const char = text[cursor]!;
      if (quote) { if (char === "\\") cursor++; else if (char === quote) quote = ""; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "[" || char === "{") stack.push(char);
      else if (char === "]" || char === "}") { if (stack.pop() !== (char === "]" ? "[" : "{")) invalid(); }
      else if (char === ";" && !stack.length) break;
      else if (/[()`=\/]/.test(char)) invalid();
    }
    if (cursor === text.length || quote || stack.length) invalid();
    if (FIELDS.has(name)) {
      if (fields.has(name)) invalid();
      try { fields.set(name, JSON.parse(text.slice(start, cursor))); } catch { invalid(); }
    }
    cursor++;
  }
  return fields;
}
