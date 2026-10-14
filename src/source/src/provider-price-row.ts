import { normalizeBarSeries } from "../../market/bars.ts";
import type { Bar } from "../../types/data.ts";

interface ProviderPriceRow {
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
}

/** Reject malformed provider rows before a normalizer can silently omit trading dates. */
export function mapProviderPriceRow(row: ProviderPriceRow, date: unknown, adjustedClose?: unknown): Bar {
  const fields = [row.open, row.high, row.low, row.close, row.volume];
  const validNumber = (value: unknown) => (typeof value === "number" || typeof value === "string")
    && (typeof value !== "string" || value.trim() !== "") && Number.isFinite(Number(value));
  if (typeof date !== "string" || fields.some(value => !validNumber(value))
    || (adjustedClose != null && (!validNumber(adjustedClose) || Number(adjustedClose) <= 0)))
    throw new Error("Provider response invalid");
  const [bar] = normalizeBarSeries([{
    date,
    open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
    volume: Number(row.volume), amount: null,
    ...(adjustedClose == null ? {} : { adjClose: Number(adjustedClose) }),
  }]);
  if (!bar) throw new Error("Provider response invalid");
  return bar;
}
