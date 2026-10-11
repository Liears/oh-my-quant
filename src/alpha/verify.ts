import { isDeepStrictEqual } from "node:util";
import type { AlphaBacktestResult } from "../types/alpha.ts";
import { validateAlphaResult } from "./backtest.ts";
import { prepareAlphaRequest, record } from "./validation.ts";
import { AlphaEngineError } from "./types.ts";

/** Recheck archived receipts and derived values; does not rerun Python or fetch data. */
export function verifyAlphaBacktestResult(result: AlphaBacktestResult): AlphaBacktestResult {
  record(result, ["version", "engine", "inputHash", "request", "curve", "fills", "orders", "metrics"], "output");
  const prepared = prepareAlphaRequest(result.request);
  if (!Array.isArray(result.curve) || !Array.isArray(result.fills) || !Array.isArray(result.orders))
    throw new AlphaEngineError("output", "Incomplete archived alpha result.");
  const reconstructed = validateAlphaResult(JSON.stringify({ protocol: 1, engine: result.engine, inputHash: result.inputHash,
    curve: result.curve.map(row => ({ date: row.date, equity: row.equity })),
    fills: result.fills.map(row => ({ ...row, symbol: prepared.request.symbol })),
    orders: result.orders.map(row => ({ ...row, symbol: prepared.request.symbol })),
  }), prepared.request, prepared.signals, prepared.inputHash);
  if (!isDeepStrictEqual(reconstructed, result)) throw new AlphaEngineError("output", "Archived alpha result differs from its verified ledger.");
  return reconstructed;
}
