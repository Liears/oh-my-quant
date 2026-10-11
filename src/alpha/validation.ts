import { createHash } from "node:crypto";
import { isDailyDate } from "../market/bars.ts";
import { isPriceAdjustment } from "../market/price-adjustment.ts";
import { isSafeProviderEndpoint } from "../market/provider-endpoint.ts";
import { smaSignals } from "../quant/backtest.ts";
import type { AlphaBacktestRequest } from "../types/alpha.ts";
import { AlphaEngineError, type AlphaErrorCode } from "./types.ts";

export const AKQUANT_VERSION = "0.3.58";
export const AKQUANT_RULE_VERSION = "1.5.4";

export function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function record(value: unknown, keys: string[], code: AlphaErrorCode): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key)))
    throw new AlphaEngineError(code, "Invalid object fields.");
  return value as Record<string, unknown>;
}

export function finite(value: unknown, minimum: number, code: AlphaErrorCode): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
    throw new AlphaEngineError(code, "Invalid numeric value.");
  return value;
}

export function identifier(value: unknown, code: AlphaErrorCode): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value))
    throw new AlphaEngineError(code, "Invalid identifier.");
  return value;
}

export function prepareAlphaRequest(input: AlphaBacktestRequest): { request: AlphaBacktestRequest; signals: number[]; inputHash: string } {
  const raw = record(structuredClone(input), ["version", "symbol", "bars", "dataset", "strategy", "initialCash", "costs", "periodsPerYear", "simulation"], "input");
  if (raw.version !== 1 || raw.simulation !== "generic-stock-next-open")
    throw new AlphaEngineError("input", "Unsupported alpha request version or simulation.");
  const symbol = identifier(raw.symbol, "input");
  if (!Array.isArray(raw.bars) || raw.bars.length < 2 || raw.bars.length > 100_000)
    throw new AlphaEngineError("input", "Provide 2 to 100000 daily bars.");
  const bars = raw.bars.map(value => {
    const bar = record(value, ["date", "open", "high", "low", "close", "volume", "amount", "adjClose"], "input");
    if (typeof bar.date !== "string" || !isDailyDate(bar.date)) throw new AlphaEngineError("input", "Invalid bar date.");
    const result = { date: bar.date, open: finite(bar.open, Number.MIN_VALUE, "input"),
      high: finite(bar.high, Number.MIN_VALUE, "input"), low: finite(bar.low, Number.MIN_VALUE, "input"),
      close: finite(bar.close, Number.MIN_VALUE, "input"), volume: finite(bar.volume, 0, "input"),
      amount: bar.amount === null ? null : finite(bar.amount, 0, "input"),
      ...(bar.adjClose === undefined ? {} : { adjClose: finite(bar.adjClose, Number.MIN_VALUE, "input") }) };
    if (result.low > Math.min(result.open, result.close) || result.high < Math.max(result.open, result.close))
      throw new AlphaEngineError("input", "OHLC bounds are inconsistent.");
    return result;
  });
  if (bars.some((bar, i) => i > 0 && bar.date <= bars[i - 1]!.date))
    throw new AlphaEngineError("input", "Bar dates must be unique and increasing.");
  const spec = record(raw.strategy, ["kind", "fast", "slow", "quantity", "values"], "input");
  const quantity = finite(spec.quantity, 1, "input");
  if (!Number.isSafeInteger(quantity)) throw new AlphaEngineError("input", "Quantity must be a safe positive integer.");
  let strategy: AlphaBacktestRequest["strategy"], signals: number[];
  if (spec.kind === "sma" && spec.values === undefined) {
    const fast = finite(spec.fast, 1, "input"), slow = finite(spec.slow, 2, "input");
    if (!Number.isSafeInteger(fast) || !Number.isSafeInteger(slow) || fast >= slow || slow > bars.length)
      throw new AlphaEngineError("input", "SMA needs integer fast < slow <= bar count.");
    strategy = { kind: "sma", fast, slow, quantity };
    signals = smaSignals(bars.map(bar => bar.close), fast, slow);
  } else if (spec.kind === "signals" && spec.fast === undefined && spec.slow === undefined
    && Array.isArray(spec.values) && spec.values.length === bars.length && Array.from(spec.values).every(v => v === 0 || v === 1)) {
    strategy = { kind: "signals", values: spec.values, quantity };
    signals = [...spec.values];
  } else throw new AlphaEngineError("input", "Unsupported strategy or signals.");
  const fees = record(raw.costs, ["commissionRate", "slippageRate"], "input");
  const costs = { commissionRate: finite(fees.commissionRate, 0, "input"), slippageRate: finite(fees.slippageRate, 0, "input") };
  if (costs.commissionRate >= 1 || costs.slippageRate >= 1) throw new AlphaEngineError("input", "Cost rates must be below 1.");
  const request: AlphaBacktestRequest = { version: 1, symbol, bars, strategy,
    initialCash: finite(raw.initialCash, Number.MIN_VALUE, "input"), costs,
    periodsPerYear: finite(raw.periodsPerYear, Number.MIN_VALUE, "input"), simulation: "generic-stock-next-open" };
  if (raw.dataset !== undefined) {
    const ref = record(raw.dataset, ["version", "kind", "symbol", "market", "source", "revision", "contentHash", "dates", "requested", "snapshotAt", "adjustment", "availability", "providerEndpoint"], "input");
    const range = record(ref.requested, ["start", "end"], "input");
    const dates = bars.map(bar => bar.date);
    if (ref.version !== 1 || ref.kind !== "daily-bars" || ref.symbol !== symbol
      || !["A", "US", "HK"].includes(String(ref.market)) || typeof ref.source !== "string" || !ref.source.trim()
      || typeof ref.revision !== "string" || !/^[a-f0-9]{64}$/.test(ref.revision) || ref.contentHash !== hash(bars)
      || JSON.stringify(ref.dates) !== JSON.stringify(dates) || !isPriceAdjustment(ref.adjustment)
      || (ref.providerEndpoint !== undefined && !isSafeProviderEndpoint(ref.providerEndpoint))
      || ref.availability !== "observed-at-fetch" || typeof ref.snapshotAt !== "string" || !Number.isFinite(Date.parse(ref.snapshotAt))
      || ![range.start, range.end].every(v => v === null || (typeof v === "string" && isDailyDate(v)))
      || (typeof range.start === "string" && range.start > dates[0]!)
      || (typeof range.end === "string" && range.end < dates.at(-1)!))
      throw new AlphaEngineError("input", "DatasetRef does not match supplied bars.");
    request.dataset = { version: 1, kind: "daily-bars", symbol, market: ref.market as "A" | "US" | "HK",
      source: ref.source, revision: ref.revision, contentHash: ref.contentHash as string, dates,
      requested: { start: range.start as string | null, end: range.end as string | null }, snapshotAt: ref.snapshotAt,
      adjustment: ref.adjustment, availability: "observed-at-fetch",
      ...(ref.providerEndpoint ? { providerEndpoint: ref.providerEndpoint } : {}) };
  }
  return { request, signals, inputHash: hash(request) };
}
