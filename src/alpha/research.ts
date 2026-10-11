import { isDeepStrictEqual } from "node:util";
import { validateDateRange } from "../market/bars.ts";
import { normalizeSymbol } from "../market/symbols.ts";
import type { Bar, DatasetRef } from "../types/data.ts";
import type { AlphaBacktestResult, AlphaResearchRequest } from "../types/alpha.ts";
import { finite, prepareAlphaRequest, record } from "./validation.ts";
import { AlphaEngineError } from "./types.ts";
import { verifyAlphaBacktestResult } from "./verify.ts";

export function normalizeAlphaResearchRequest(value: unknown): AlphaResearchRequest {
  const input = record(value, ["symbol", "start", "end", "fast", "slow", "quantity", "cash", "commission", "slippage", "periods_per_year", "simulation"], "input");
  if (typeof input.symbol !== "string" || typeof input.start !== "string" || typeof input.end !== "string")
    throw new AlphaEngineError("input", "Specify symbol and date window.");
  validateDateRange(input.start, input.end);
  const symbol = normalizeSymbol(input.symbol);
  if (symbol.endsWith(".OF") || !input.start || !input.end || input.start >= input.end || input.simulation !== "generic-stock-next-open")
    throw new AlphaEngineError("input", "Alpha research needs daily OHLC, a nonzero window and explicit generic-stock simulation.");
  const request: AlphaResearchRequest = { symbol, start: input.start, end: input.end,
    fast: finite(input.fast, 1, "input"), slow: finite(input.slow, 2, "input"), quantity: finite(input.quantity, 1, "input"),
    cash: finite(input.cash, Number.MIN_VALUE, "input"), commission: finite(input.commission, 0, "input"), slippage: finite(input.slippage, 0, "input"),
    periods_per_year: finite(input.periods_per_year, 1, "input"), simulation: "generic-stock-next-open" };
  if (![request.fast, request.slow, request.quantity].every(Number.isSafeInteger) || request.fast >= request.slow
    || request.slow > 100_000 || request.commission >= 1 || request.slippage >= 1 || request.periods_per_year > 366)
    throw new AlphaEngineError("input", "Invalid SMA, size, costs or daily annualization assumptions.");
  return request;
}

export function alphaRequestFromResearch(input: AlphaResearchRequest, bars: Bar[], dataset: DatasetRef) {
  const request = normalizeAlphaResearchRequest(input);
  if (!dataset || dataset.requested.start !== request.start || dataset.requested.end !== request.end)
    throw new AlphaEngineError("input", "Alpha research requires the exact requested DatasetRef window.");
  return prepareAlphaRequest({ version: 1, symbol: request.symbol, bars, dataset,
    strategy: { kind: "sma", fast: request.fast, slow: request.slow, quantity: request.quantity }, initialCash: request.cash,
    costs: { commissionRate: request.commission, slippageRate: request.slippage }, periodsPerYear: request.periods_per_year, simulation: request.simulation }).request;
}

/** Bind the original research assumptions as well as the engine's input and receipts. */
export function verifyAlphaResearchResult(input: AlphaResearchRequest, result: AlphaBacktestResult): AlphaBacktestResult {
  const verified = verifyAlphaBacktestResult(result);
  const expected = alphaRequestFromResearch(input, verified.request.bars, verified.request.dataset!);
  if (!isDeepStrictEqual(expected, verified.request)) throw new AlphaEngineError("output", "Alpha result does not match the research request.");
  return verified;
}
