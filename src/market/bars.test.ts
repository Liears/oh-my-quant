import { expect, it } from "bun:test";
import { normalizeBarSeries } from "./bars.ts";
import type { Bar } from "../types/data.ts";

it("rejects contradictory OHLC observations while preserving valid daily prices", () => {
  const valid: Bar = { date: "2026-01-06", open: 100, high: 110, low: 90, close: 105, volume: 12, amount: 1200 };
  const invalid = [
    { ...valid, date: "2026-01-07", high: 85 },
    { ...valid, date: "2026-01-08", low: 115 },
    { ...valid, date: "2026-01-09", close: 111 },
    { ...valid, date: "2026-01-10", open: 89 },
  ];
  expect(normalizeBarSeries([valid, ...invalid])).toEqual([valid]);
});

it("keeps missing turnover distinct from a reported zero and rejects malformed turnover", () => {
  const base = { date: "2026-01-06", open: 100, high: 110, low: 90, close: 105, volume: 12 };
  expect(normalizeBarSeries([
    base,
    { ...base, date: "2026-01-07", amount: 0 },
    { ...base, date: "2026-01-08", amount: "not-a-number" },
  ])).toEqual([
    { ...base, amount: null },
    { ...base, date: "2026-01-07", amount: 0 },
  ]);
});
