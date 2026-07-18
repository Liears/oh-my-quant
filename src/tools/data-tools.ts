import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { DataSource } from "../source/index.ts";
import { fetchBars, searchSymbols } from "../runtime/source-runtime.ts";
import type { Market } from "../types/data.ts";
import { inferMarket } from "../market/symbols.ts";
import { ok } from "./shared/results.ts";
import { formatBarsChartBlock } from "./shared/bars-preview.ts";
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
});

const SearchSymbols = Type.Object({
  keyword: Type.String({ description: "Symbol keyword or Chinese stock name" }),
  market: Type.Optional(Type.String({ description: "Market code, default A" })),
});

const FetchSnapshot = Type.Object({
  symbol: Type.String({ description: "Market symbol such as 000001.SZ or AAPL" }),
  market: Type.Optional(Type.String({ description: "Market code: A, US, HK" })),
});

function unsupported(symbol: string, market: string): AgentToolResult<unknown> {
  return ok(
    [
      `No daily-bars adapter is available for ${symbol} in market ${market}.`,
      `Market     ${market}`,
      "Source     akshare supports A-share, index, and fund symbols",
      "Next       Use an A-share/fund symbol, or ask the agent to update local files from a configured source.",
    ].join("\n"),
    { symbol, market, source: "unavailable", barCount: 0 },
  );
}

export const fetchBarsTool: AgentTool<typeof FetchBars> = {
  name: "fetch_bars",
  description: "Fetch and cache daily bars through the data source selected in /config. An explicit source overrides it for this call.",
  label: "Fetch Bars",
  parameters: FetchBars,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchBars>): Promise<AgentToolResult<unknown>> {
    const market = (args.market || inferMarket(args.symbol)) as Market;
    if (market !== "A") {
      return unsupported(args.symbol, market);
    }

    const source: DataSource | undefined = isDataSource(args.source) ? args.source : undefined;
    const result = await fetchBars(args.symbol, market, args.start, args.end, source);
    if (result.bars.length === 0) {
      return ok(
        [
          `No daily bars were returned for ${args.symbol}.`,
          `Market     ${market}`,
          `Source     ${source || "configured source"}`,
          "Next       Check the symbol/date range, or run /config to verify the data source.",
        ].join("\n"),
        { symbol: args.symbol, market, source: "akshare", barCount: 0 },
      );
    }

    const first = result.bars[0];
    const latest = result.bars[result.bars.length - 1];
    return ok(
      [
        `Downloaded  ${args.symbol}`,
        ...formatBarsChartBlock(result.bars),
        `Source      ${result.source}`,
        `Bars        ${result.bars.length}`,
        `Range       ${first?.date} → ${latest?.date}`,
        `Latest      ${latest?.close.toFixed(2)}`,
      ].join("\n"),
      { symbol: args.symbol, market, source: result.source, barCount: result.bars.length },
    );
  },
};

export const searchSymbolsTool: AgentTool<typeof SearchSymbols> = {
  name: "search_symbols",
  description: "Search stock symbols through the configured direct adapters.",
  label: "Search Symbols",
  parameters: SearchSymbols,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof SearchSymbols>): Promise<AgentToolResult<unknown>> {
    const rows = await searchSymbols(args.keyword, (args.market as Market | undefined) || "A");
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
  async execute(_id: string, args: Static<typeof FetchSnapshot>): Promise<AgentToolResult<unknown>> {
    const market = (args.market || inferMarket(args.symbol)) as Market;
    let snapshot: Record<string, unknown>;
    // Tushare daily_basic requires a higher permission tier. Daily OHLCV is
    // enough for a trading snapshot and uses the configured source/token.
    const result = await fetchBars(args.symbol, market);
    const latest = result.bars.at(-1);
    snapshot = latest
      ? { date: latest.date, open: latest.open, high: latest.high, low: latest.low, close: latest.close, volume: latest.volume, amount: latest.amount, source: result.source }
      : {};
    const rows = Object.entries(snapshot)
      .filter(([, value]) => value != null && value !== "")
      .slice(0, 8)
      .map(([key, value]) => `${key}  ${String(value)}`);
    if (rows.length === 0) {
      return ok(
        [
          `No snapshot fields were returned for ${args.symbol}.`,
          `Market     ${market}`,
          "Next       Check the symbol and configured data keys in /config, then retry.",
        ].join("\n"),
        { symbol: args.symbol, market },
      );
    }
    return ok([`Snapshot  ${args.symbol}`, ...rows].join("\n"), { symbol: args.symbol, market, snapshot });
  },
};

export const DATA_TOOLS: AgentTool[] = [
  fetchBarsTool,
  searchSymbolsTool,
  fetchSnapshotTool,
  ...AKSHARE_INDEX_TOOLS,
  ...AKSHARE_FUND_TOOLS,
];

function isDataSource(value: unknown): value is Exclude<DataSource, "auto"> {
  return value === "akshare" || value === "tushare" || value === "llmquant-data" || value === "financial-datasets";
}
