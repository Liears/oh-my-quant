import { normalizeSymbol } from "../../market/symbols.ts";
import type { Bar, Market } from "../../types/data.ts";
import { parseAkshareBarsResultJson } from "./akshare-normalize.ts";
import { runPython } from "./akshare-python.ts";
import type { AkshareBarsResult } from "./akshare-types.ts";
import { fetchSinaGlobalHistory, sinaHistoryEndpoint } from "./sina-global-history.ts";

/** Public Sina daily history exposed through AKShare, requested with adjust="". */
export async function fetchFromAKShareGlobalDetailed(
  symbol: string,
  market: Extract<Market, "US" | "HK">,
  start?: string,
  end?: string,
  signal?: AbortSignal,
): Promise<AkshareBarsResult> {
  signal?.throwIfAborted();
  const normalized = normalizeSymbol(symbol, market);
  const code = market === "HK" ? normalized.slice(0, -3) : normalized;
  let result: AkshareBarsResult;
  try {
    const { stdout } = await runPython(AKSHARE_GLOBAL_BARS_SCRIPT, [market, code, start ?? "", end ?? ""], { signal });
    signal?.throwIfAborted();
    result = parseAkshareBarsResultJson(JSON.parse(stdout));
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof Error) || !/\bWinError\s+4551\b/i.test(error.message)) throw error;
    const bars = await fetchSinaGlobalHistory(normalized, market, start, end, signal), endpoint = sinaHistoryEndpoint(market);
    return { bars, endpoint, adjustment: "unadjusted", attempts: [
      { endpoint: market === "US" ? "stock_us_daily" : "stock_hk_daily", status: "error", error: "Native runtime blocked (WinError 4551)" },
      { endpoint, status: "ok", rows: bars.length },
    ] };
  }
  return { ...result, adjustment: result.endpoint === (market === "US" ? "stock_us_daily" : "stock_hk_daily")
    ? "unadjusted" : "provider-unspecified" };
}

export async function fetchFromAKShareGlobal(
  symbol: string,
  market: Extract<Market, "US" | "HK">,
  start?: string,
  end?: string,
  signal?: AbortSignal,
): Promise<Bar[]> {
  return (await fetchFromAKShareGlobalDetailed(symbol, market, start, end, signal)).bars;
}

export const AKSHARE_GLOBAL_BARS_SCRIPT = `
import json, sys
import akshare as ak
import pandas as pd

market, symbol, start, end = sys.argv[1:5]
endpoint = "stock_us_daily" if market == "US" else "stock_hk_daily" if market == "HK" else None
if endpoint is None:
    print(json.dumps({"error": "unsupported market"}))
    sys.exit(0)

try:
    df = getattr(ak, endpoint)(symbol=symbol, adjust="")
    if not isinstance(df, pd.DataFrame):
        raise ValueError("invalid daily history")
    df = df.copy()
    if "date" not in df.columns:
        raise ValueError("missing date column")
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.strftime("%Y-%m-%d")
    df = df.dropna(subset=["date"])
    if start:
        df = df[df["date"] >= start]
    if end:
        df = df[df["date"] <= end]
    if not start and not end:
        df = df.tail(30)
    columns = ["date", "open", "high", "low", "close", "volume", "amount"]
    df = df[[column for column in columns if column in df.columns]]
    if "amount" not in df.columns:
        df["amount"] = None
    rows = json.loads(df.to_json(orient="records"))
    print(json.dumps({"bars": rows, "endpoint": endpoint,
        "attempts": [{"endpoint": endpoint, "status": "ok", "rows": len(rows)}]}))
except Exception as error:
    print(json.dumps({"error": str(error)[:240], "endpoint": endpoint,
        "attempts": [{"endpoint": endpoint, "status": "error", "error": str(error)[:240]}]}))
`;
