import { isDailyDate, normalizeBarSeries, validateDateRange } from "../../market/bars.ts";
import type { Bar } from "../../types/data.ts";
import { decodeSinaHistory } from "./vendor/sina-history-decoder.js";

export const SINA_HISTORY_MAX_BYTES = 2 * 1024 * 1024;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function assertSinaCommentTail(text: string): void {
  let cursor = 0;
  while (cursor < text.length) {
    if (/\s/.test(text[cursor]!)) { cursor++; continue; }
    if (!text.startsWith("/*", cursor)) throw new Error("Provider response invalid");
    const close = text.indexOf("*/", cursor + 2);
    if (close < 0) throw new Error("Provider response invalid");
    cursor = close + 2;
  }
}

/** The response contributes an encoded string only; the decoder is static local code. */
export function parseSinaHistoryPayload(variable: string, text: string, amount: "preserve" | "unavailable", start?: string, end?: string): Bar[] {
  validateDateRange(start, end);
  if (Buffer.byteLength(text, "utf8") > SINA_HISTORY_MAX_BYTES) throw new Error("Provider response truncated");
  const declaration = /^\s*var\s+([A-Za-z_$][\w$]*)\s*=\s*"([A-Za-z0-9+/]+)"\s*;/.exec(text);
  if (!declaration) throw new Error("Provider response invalid");
  if (declaration[1] !== variable) throw new Error("Provider identity mismatch");
  assertSinaCommentTail(text.slice(declaration[0].length));
  const encoded = declaration[2]!;
  if (encoded.length > 1024 * 1024) throw new Error("Provider response truncated");
  const format = ALPHABET.indexOf(encoded[0]!) | (ALPHABET.indexOf(encoded[1]!) << 6);
  if (encoded.length < 3 || ![1479, 3466].includes(format) || encoded[2] !== "/") throw new Error("Provider response invalid");
  let decoded: unknown;
  try { decoded = decodeSinaHistory(encoded); } catch { throw new Error("Provider response invalid"); }
  if (!Array.isArray(decoded) || !decoded.length || decoded.length > 100_000) throw new Error("Provider response invalid");
  const rows: Array<Record<string, unknown>> = [];
  let previousDate = "";
  for (const item of decoded) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Provider response invalid");
    const row = item as Record<string, unknown>;
    if (!(row.date instanceof Date) || !Number.isFinite(row.date.getTime())) throw new Error("Provider response invalid");
    const date = row.date.toISOString().slice(0, 10);
    if (!isDailyDate(date) || date <= previousDate) throw new Error("Provider response invalid");
    previousDate = date;
    rows.push({ ...row, date, amount: amount === "unavailable" ? null : row.amount ?? null });
  }
  const selected = start || end ? rows.filter(row => (!start || String(row.date) >= start) && (!end || String(row.date) <= end)) : rows.slice(-30);
  const bars = normalizeBarSeries(selected);
  if (bars.length !== selected.length) throw new Error("Provider response invalid");
  return bars;
}
