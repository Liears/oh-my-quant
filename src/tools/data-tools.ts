import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { DataSource } from "../source/index.ts";
import { fetchBars, searchSymbols } from "../runtime/source-runtime.ts";
import type { Market } from "../types/data.ts";
import { inferMarket, normalizeSymbol } from "../market/symbols.ts";
import { validateObservationCutoff } from "../market/observation-cutoff.ts";
import { err, ok } from "./shared/results.ts";
import { formatBarsChartBlock } from "./shared/bars-preview.ts";
import { dataTimeEvidence } from "./shared/data-time-evidence.ts";
import { AKSHARE_FUND_TOOLS } from "./akshare-fund-tools.ts";
import { AKSHARE_INDEX_TOOLS } from "./akshare-index-tools.ts";

export { formatBarsChartBlock } from "./shared/bars-preview.ts";
export {
  fetchIndexConstituentsTool,
  fetchIndexInfoTool,
  fetchIndexRowsTool,
  fetchIndexSpotTool,
} from "./akshare-index-tools.ts";

const FetchBars = Type.Object({
  symbol: Type.String({ description: "Market symbol such as 000300.SH or 159915" }),
  market: Type.Optional(Type.String({ description: "Market code: A, US, HK" })),
  start: Type.Optional(Type.String({ description: "Start date YYYY-MM-DD" })),
  end: Type.Optional(Type.String({ description: "End date YYYY-MM-DD" })),
  source: Type.Optional(Type.String({ description: "Optional override: akshare, tushare, llmquant-data, or financial-datasets. Defaults to /config." })),
  observed_before: Type.Optional(Type.String({ description: "Exact UTC application observation cutoff YYYY-MM-DDTHH:mm:ss.sssZ. Opt-in archive-only request; no provider call or current cache head. Does not prove provider publication or trading-day completeness." })),
});

const SearchSymbols = Type.Object({
  keyword: Type.String({ description: "Symbol keyword or Chinese stock name" }),
  market: Type.Optional(Type.String({ description: "Market code, default A" })),
});

const FetchSnapshot = Type.Object({
  symbol: Type.String({ description: "Market symbol such as 000001.SZ or AAPL" }),
  market: Type.Optional(Type.String({ description: "Market code: A, US, HK" })),
});

export const fetchBarsTool: AgentTool<typeof FetchBars> = {
  name: "fetch_bars",
  description: "Fetch and cache daily bars through the data source selected in /config. An explicit source overrides it for this call. Optional observed_before selects only immutable local responses the app observed by that exact UTC instant, without contacting current providers or using later heads. Price date is not observation/publication time; historical exchange availability and complete trading days are not proven.",
  label: "Fetch Bars",
  parameters: FetchBars,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchBars>, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const market = (args.market || inferMarket(args.symbol)) as Market;
    if (!["A", "US", "HK"].includes(market)) return err("INPUT_INVALID_SYMBOL", "Market must be A, US, or HK.");
    try { normalizeSymbol(args.symbol, market); }
    catch { return err("INPUT_INVALID_SYMBOL", "Symbol must match the selected market."); }
    if (args.source !== undefined && !isDataSource(args.source)) return err("DATA_BACKEND_UNAVAILABLE", "Unknown source. Choose auto, akshare, tushare, llmquant-data, or financial-datasets.");
    if (args.observed_before !== undefined) {
      try { validateObservationCutoff(args.observed_before); }
      catch { return err("DATA_INVALID_OBSERVATION_CUTOFF"); }
    }

    const source: DataSource | undefined = isDataSource(args.source) ? args.source : undefined;
    let result: Awaited<ReturnType<typeof fetchBars>>;
    try { result = await fetchBars(args.symbol, market, args.start, args.end, source, {
      providers: { signal }, ...(args.observed_before ? { observedBefore: args.observed_before } : {}) }); }
    catch (error) {
      if (args.observed_before) {
        signal?.throwIfAborted();
        if (error instanceof Error && error.message.includes("archive unavailable")) return err("DATA_ASOF_ARCHIVE_UNAVAILABLE");
      }
      throw error;
    }
    signal?.throwIfAborted();
    if (args.observed_before && result.bars.length === 0) return err("DATA_NO_ASOF_ARCHIVE");
    if (result.bars.length === 0) {
      return ok(
        [
          `No daily bars were returned for ${args.symbol}.`,
          `Market     ${market}`,
          `Source     ${source || "configured source"}`,
          ...(result.budgetExhausted ? ["Refresh    source request budget exhausted"] : []),
          "Next       Check the symbol/date range, or run /config to verify the data source.",
        ].join("\n"),
        { symbol: args.symbol, market, source: result.source, origin: result.origin, attempts: result.attempts, barCount: 0,
          ...(result.budgetExhausted ? { budgetExhausted: true } : {}) },
      );
    }

    const first = result.bars[0];
    const latest = result.bars[result.bars.length - 1];
    const time = dataTimeEvidence(result);
    return ok(
      [
        `Daily bars  ${args.symbol}`,
        ...formatBarsChartBlock(result.bars),
        `Source      ${result.source}`,
        ...(result.providerEndpoint ? [`Endpoint    ${result.providerEndpoint}`] : []),
        `Status      ${result.historicalBoundary?.evidence === "app-archive" ? "archive-only historical observation" : result.origin === "stale-cache" ? "offline fallback — cached data, refresh failed" : result.origin}`,
        ...(result.budgetExhausted ? ["Refresh     source request budget exhausted"] : []),
        `Bars        ${result.bars.length}`,
        `Range       ${first?.date} → ${latest?.date}`,
        `Price date  ${latest?.date}`,
        `App observed ${time.observationAt ?? "unverified"}`,
        time.priceAdjustmentNote,
        `Historical  ${result.historicalBoundary?.evidence === "app-archive" ? "app archive met observation cutoff; not provider publication or complete trading-calendar evidence" : "observed-at-fetch only; price date does not prove historical availability or complete trading-calendar evidence"}`,
        `Latest      ${latest?.close.toFixed(2)}`,
      ].join("\n"),
      { symbol: args.symbol, market, source: result.source, origin: result.origin, dataset: result.dataset, asOfDate: result.asOfDate,
        ...time,
        ...(result.historicalBoundary ? { historicalBoundary: result.historicalBoundary } : {}),
        ...(result.budgetExhausted ? { budgetExhausted: true } : {}),
        ...(result.providerEndpoint ? { providerEndpoint: result.providerEndpoint } : {}),
        turnoverSemantics: result.turnoverSemantics, attempts: result.attempts, barCount: result.bars.length },
    );
  },
};

const FetchArchivedBars = Type.Object({
  ...FetchBars.properties,
  observed_before: Type.String({ description: "Required exact UTC application observation cutoff YYYY-MM-DDTHH:mm:ss.sssZ. Reads only immutable local response revisions observed by then; no provider or current head." }),
});

/** Explicit offline entry point so readiness describes its actual provider-free contract. */
export const fetchArchivedBarsTool: AgentTool<typeof FetchArchivedBars> = {
  name: "fetch_bars_archive",
  description: "Read a complete daily-bar response from immutable application archives observed by observed_before. No market provider call or current cache head. Observation time does not prove provider publication or complete trading days.",
  label: "Archived Bars",
  parameters: FetchArchivedBars,
  executionMode: "sequential",
  execute(id: string, args: Static<typeof FetchArchivedBars>, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
    return fetchBarsTool.execute(id, args, signal);
  },
};

export const searchSymbolsTool: AgentTool<typeof SearchSymbols> = {
  name: "search_symbols",
  description: "Search A-share stock symbols through Tushare stock_basic. Requires a Tushare token; US/HK search is not supported.",
  label: "Search Symbols",
  parameters: SearchSymbols,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof SearchSymbols>, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    if (args.market && args.market !== "A") return err("INPUT_INVALID_SYMBOL", "Symbol search supports A shares only. Use the full symbol for US/HK research.");
    const rows = await searchSymbols(args.keyword, (args.market as Market | undefined) || "A", signal);
    signal?.throwIfAborted();
    if (rows.length === 0) {
      return ok(
        [
          `No symbols matched "${args.keyword}".`,
          "Next       Try a full code such as 000001.SZ, or use a more specific Chinese/English name.",
        ].join("\n"),
        { count: 0 },
      );
    }
    const top = rows.slice(0, 10);
    return ok(
      [`Found  ${rows.length}`, ...top.map((row) => `${row.code}  ${row.name}`)].join("\n"),
      { count: rows.length, rows: top },
    );
  },
};

export const fetchSnapshotTool: AgentTool<typeof FetchSnapshot> = {
  name: "fetch_snapshot",
  description: "Fetch a compact latest-price snapshot through the data source selected in /config.",
  label: "Snapshot",
  parameters: FetchSnapshot,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchSnapshot>, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const market = (args.market || inferMarket(args.symbol)) as Market;
    if (!["A", "US", "HK"].includes(market)) return err("INPUT_INVALID_SYMBOL", "Market must be A, US, or HK.");
    try { normalizeSymbol(args.symbol, market); }
    catch { return err("INPUT_INVALID_SYMBOL", "Symbol must match the selected market."); }

    // Tushare daily_basic requires a higher permission tier. Daily OHLCV is
    // enough for a trading snapshot and uses the configured source/token.
    const result = await fetchBars(args.symbol, market, undefined, undefined, undefined, { providers: { signal } });
    signal?.throwIfAborted();
    const latest = result.bars.at(-1);
    const legacyZero = latest?.amount === 0 && result.origin !== "provider" && result.turnoverSemantics !== "nullable";
    const snapshot: Record<string, unknown> = latest
      ? { date: latest.date, open: latest.open, high: latest.high, low: latest.low, close: latest.close, volume: latest.volume,
          amount: legacyZero ? null : latest.amount, ...(legacyZero ? { amountEvidence: "legacy-unknown" } : {}), source: result.source, origin: result.origin,
          ...(result.providerEndpoint ? { providerEndpoint: result.providerEndpoint } : {}) }
      : {};
    const rows = Object.entries(snapshot)
      .filter(([, value]) => value !== "")
      .slice(0, 12)
      .map(([key, value]) => `${key}  ${value == null ? "unavailable" : String(value)}`);
    if (rows.length === 0) {
      return ok(
        [
          `No snapshot fields were returned for ${args.symbol}.`,
          `Market     ${market}`,
          ...(result.budgetExhausted ? ["Refresh    source request budget exhausted"] : []),
          "Next       Check the symbol and configured data keys in /config, then retry.",
        ].join("\n"),
        { symbol: args.symbol, market, ...(result.budgetExhausted ? { budgetExhausted: true } : {}) },
      );
    }
    const time = dataTimeEvidence(result);
    return ok([`Snapshot  ${args.symbol}`, ...rows,
      ...(result.budgetExhausted ? [`Refresh    source request budget exhausted${result.origin === "stale-cache" ? "; snapshot is cached" : ""}`] : []),
      `Price date  ${time.latestBarDate}`, `App observed ${time.observationAt ?? "unverified"}`,
      time.priceAdjustmentNote,
      `Historical  ${time.historicalAvailability}; price date is not application observation or proven publication time`].join("\n"),
      { symbol: args.symbol, market, dataset: result.dataset, snapshot, ...time,
        ...(result.budgetExhausted ? { budgetExhausted: true } : {}) });
  },
};

export const DATA_TOOLS: AgentTool[] = [
  fetchBarsTool,
  searchSymbolsTool,
  fetchSnapshotTool,
  fetchArchivedBarsTool,
  ...AKSHARE_INDEX_TOOLS,
  ...AKSHARE_FUND_TOOLS,
];

function isDataSource(value: unknown): value is DataSource {
  return value === "auto" || value === "akshare" || value === "tushare" || value === "llmquant-data" || value === "financial-datasets";
}
