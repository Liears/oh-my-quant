import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  AKSHARE_PUBLIC_INDEX_ENDPOINTS,
  fetchAkshareAIndexSpot,
  fetchAkshareIndexConstituents,
  fetchAkshareIndexInfo,
  fetchAkshareIndexRows,
  type AkshareIndexConstituent,
  type AkshareIndexConstituentsResult,
  type AkshareIndexInfoRow,
  type AkshareIndexQuote,
  type AksharePublicIndexEndpoint,
} from "../source/index.ts";
import { ok } from "./shared/results.ts";
import {
  formatCell,
  formatParamLine,
  formatRecordPreview,
  outputLimit,
  textValue,
} from "./shared/row-preview.ts";

const FetchIndexSpot = Type.Object({
  symbol: Type.Optional(Type.String({ description: "AKShare stock_zh_index_spot_em category, e.g. 沪深重要指数/上证系列指数/深证系列指数/中证系列指数. Defaults to common A-share index categories." })),
  keyword: Type.Optional(Type.String({ description: "Local keyword filter across index code/name/category." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum rows to include. Default 20." })),
});

const FetchIndexInfo = Type.Object({
  keyword: Type.Optional(Type.String({ description: "Local keyword filter across index code/name/publish date." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Maximum rows to include. Default 20." })),
});

const FetchIndexConstituents = Type.Object({
  symbol: Type.String({ description: "Index code such as 000300, 399300, 000905, or 399639." }),
  keyword: Type.Optional(Type.String({ description: "Local keyword filter across stock code/name/exchange." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Maximum constituents to include. Default 20." })),
  source_priority: Type.Optional(Type.String({ description: "Optional source order: csindex,sina,index_stock_cons. Default tries csindex then sina then index_stock_cons." })),
});

const FetchIndexRows = Type.Object({
  endpoint: Type.String({ description: "Whitelisted AKShare index endpoint, e.g. index_zh_a_hist, stock_zh_index_spot_em, index_realtime_sw, stock_zh_index_hist_csindex." }),
  params: Type.Optional(Type.Any({ description: "Endpoint keyword parameters passed to AKShare, such as { symbol: '000300', start_date: '20260101', end_date: '20260627' }." })),
  keyword: Type.Optional(Type.String({ description: "Local keyword filter across returned values. Not passed to AKShare." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum rows to include. Default 20." })),
});

export const fetchIndexSpotTool: AgentTool<typeof FetchIndexSpot> = {
  name: "fetch_index_spot",
  description: "Fetch realtime A-share index quotes through AKShare stock_zh_index_spot_em.",
  label: "Index Spot",
  parameters: FetchIndexSpot,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchIndexSpot>, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const categories = args.symbol
      ? [args.symbol]
      : ["沪深重要指数", "上证系列指数", "深证系列指数", "中证系列指数"];
    const quotes = await fetchAkshareAIndexSpot(categories, signal);
    const filtered = filterIndexQuotes(quotes, args.keyword);
    const rows = filtered.slice(0, outputLimit(args.limit));
    if (rows.length === 0) {
      return ok(
        [
          "Index Spot  no rows",
          "Source      akshare:stock_zh_index_spot_em",
          args.keyword ? `Filter      ${args.keyword}` : "Filter      --",
        ].join("\n"),
        { source: "akshare", endpoint: "stock_zh_index_spot_em", categories, count: 0, quotes: [] },
      );
    }
    return ok(
      [
        "Index Spot  AKShare realtime",
        "Endpoint    stock_zh_index_spot_em",
        `Rows        ${filtered.length}`,
        ...rows.map(formatIndexQuoteRow),
      ].join("\n"),
      { source: "akshare", endpoint: "stock_zh_index_spot_em", categories, count: filtered.length, quotes: rows },
    );
  },
};

export const fetchIndexInfoTool: AgentTool<typeof FetchIndexInfo> = {
  name: "fetch_index_info",
  description: "Fetch AKShare index_stock_info catalogue rows for index code lookup.",
  label: "Index Info",
  parameters: FetchIndexInfo,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchIndexInfo>, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const data = await fetchAkshareIndexInfo(args.keyword, undefined, signal);
    const rows = data.rows.slice(0, outputLimit(args.limit, 20, 500));
    return ok(
      formatIndexInfoText(data.rowCount, data.rows.length, rows, args.keyword),
      {
        source: "akshare",
        endpoint: "index_stock_info",
        fetchedAt: data.fetchedAt,
        rowCount: data.rowCount,
        filteredRowCount: data.rows.length,
        rows,
      },
    );
  },
};

export const fetchIndexConstituentsTool: AgentTool<typeof FetchIndexConstituents> = {
  name: "fetch_index_constituents",
  description: "Fetch latest index constituents through AKShare, preferring csindex/sina and falling back to index_stock_cons.",
  label: "Index Constituents",
  parameters: FetchIndexConstituents,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchIndexConstituents>, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const data = await fetchAkshareIndexConstituents(args.symbol, args.source_priority, signal);
    const filtered = filterIndexConstituents(data.constituents, args.keyword);
    const rows = filtered.slice(0, outputLimit(args.limit, 20, 500));
    return ok(
      formatIndexConstituentsText(data, filtered.length, rows, args.keyword),
      {
        source: "akshare",
        endpoint: data.source,
        symbol: data.symbol,
        indexName: data.indexName,
        fetchedAt: data.fetchedAt,
        count: data.constituents.length,
        filteredCount: filtered.length,
        rows,
        attempts: data.attempts,
      },
    );
  },
};

export const fetchIndexRowsTool: AgentTool<typeof FetchIndexRows> = {
  name: "fetch_index_rows",
  description: "Fetch rows from a whitelisted AKShare index endpoint with local preview filtering.",
  label: "Index Rows",
  parameters: FetchIndexRows,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchIndexRows>, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const endpoint = args.endpoint.trim();
    if (!AKSHARE_PUBLIC_INDEX_ENDPOINTS.includes(endpoint as AksharePublicIndexEndpoint)) {
      return ok(
        [
          `Unsupported AKShare index endpoint: ${endpoint}`,
          "Next       Use one of the whitelisted index endpoints from AKSHARE_PUBLIC_INDEX_ENDPOINTS.",
        ].join("\n"),
        { endpoint, supportedEndpoints: AKSHARE_PUBLIC_INDEX_ENDPOINTS },
      );
    }
    const params = isRecord(args.params) ? args.params : {};
    const data = await fetchAkshareIndexRows(endpoint as AksharePublicIndexEndpoint, params, signal);
    const filtered = filterRowsByKeyword(data.rows, args.keyword);
    const rows = filtered.slice(0, outputLimit(args.limit));
    return ok(
      formatIndexRowsText(endpoint, data.rowCount, filtered.length, rows, params, args.keyword),
      {
        source: "akshare",
        endpoint,
        params,
        fetchedAt: data.fetchedAt,
        rowCount: data.rowCount,
        filteredRowCount: filtered.length,
        rows,
      },
    );
  },
};

export const AKSHARE_INDEX_TOOLS: AgentTool[] = [
  fetchIndexSpotTool,
  fetchIndexInfoTool,
  fetchIndexConstituentsTool,
  fetchIndexRowsTool,
];

function formatIndexInfoText(
  rowCount: number,
  filteredRowCount: number,
  rows: AkshareIndexInfoRow[],
  keyword?: string,
): string {
  const lines = [
    "Index Info  AKShare index_stock_info",
    `Rows        ${filteredRowCount === rowCount ? rowCount : `${filteredRowCount} / ${rowCount}`}`,
  ];
  if (keyword) lines.push(`Filter      ${keyword}`);
  if (rows.length === 0) {
    lines.push("Preview     --");
    return lines.join("\n");
  }
  lines.push(...rows.map((row) => `${row.indexCode.padEnd(8)} ${row.displayName.padEnd(18)} ${row.publishDate || "--"}`));
  return lines.join("\n");
}

function filterIndexConstituents(rows: AkshareIndexConstituent[], keyword?: string): AkshareIndexConstituent[] {
  const lower = String(keyword || "").trim().toLowerCase();
  if (!lower) return rows;
  return rows.filter((row) => [
    row.stockCode,
    row.stockName,
    row.inclusionDate,
    row.indexCode,
    row.indexName,
    row.exchange,
    row.source,
  ].some((value) => String(value || "").toLowerCase().includes(lower)));
}

function formatIndexConstituentsText(
  data: AkshareIndexConstituentsResult,
  filteredCount: number,
  rows: AkshareIndexConstituent[],
  keyword?: string,
): string {
  const title = data.indexName ? `${data.indexName} (${data.symbol})` : data.symbol;
  const lines = [
    `Index Cons  ${title}`,
    `Source      ${data.source || "--"}`,
    `Rows        ${filteredCount === data.constituents.length ? data.constituents.length : `${filteredCount} / ${data.constituents.length}`}`,
  ];
  if (keyword) lines.push(`Filter      ${keyword}`);
  if (data.attempts.length > 0) {
    lines.push(`Attempts    ${data.attempts.map((attempt) => `${attempt.endpoint}:${attempt.status}${attempt.rows == null ? "" : `(${attempt.rows})`}`).join(" -> ")}`);
  }
  if (rows.length === 0) {
    lines.push("Preview     --");
    return lines.join("\n");
  }
  rows.forEach((row, index) => lines.push(formatIndexConstituentRow(row, index + 1)));
  return lines.join("\n");
}

function formatIndexConstituentRow(row: AkshareIndexConstituent, index: number): string {
  const extras = [
    row.inclusionDate ? `纳入=${row.inclusionDate}` : "",
    row.weight == null ? "" : `权重=${formatCell(row.weight)}%`,
    row.exchange ? `交易所=${row.exchange}` : "",
  ].filter(Boolean).join("  ");
  return `${String(index).padStart(2, "0")}         ${row.stockCode.padEnd(8)} ${row.stockName.padEnd(12)}${extras ? `  ${extras}` : ""}`;
}

function filterIndexQuotes(rows: AkshareIndexQuote[], keyword?: string): AkshareIndexQuote[] {
  const lower = String(keyword || "").trim().toLowerCase();
  if (!lower) return rows;
  return rows.filter((row) => [row.code, row.name, row.category].some((value) => String(value || "").toLowerCase().includes(lower)));
}

function formatIndexQuoteRow(row: AkshareIndexQuote): string {
  const category = row.category ? `  ${row.category}` : "";
  return `${row.code.padEnd(8)} ${row.name.padEnd(12)} ${row.price.toFixed(2).padStart(10)}  ${formatSignedPct(row.changePct ?? 0).padStart(8)}${category}`;
}

function filterRowsByKeyword(rows: Record<string, unknown>[], keyword?: string): Record<string, unknown>[] {
  const lower = String(keyword || "").trim().toLowerCase();
  if (!lower) return rows;
  return rows.filter((row) => Object.values(row).some((value) => textValue(value).toLowerCase().includes(lower)));
}

function formatIndexRowsText(
  endpoint: string,
  rowCount: number,
  filteredRowCount: number,
  rows: Record<string, unknown>[],
  params: Record<string, unknown>,
  keyword?: string,
): string {
  const lines = [
    `AKShare    ${endpoint}`,
    `Rows       ${filteredRowCount === rowCount ? rowCount : `${filteredRowCount} / ${rowCount}`}`,
  ];
  const paramLine = formatParamLine(params);
  if (paramLine) lines.push(`Params     ${paramLine}`);
  if (keyword) lines.push(`Filter     ${keyword}`);
  lines.push(...formatRecordPreview(rows, INDEX_PREVIEW_FIELD_PRIORITY, { maxFields: 8 }));
  return lines.join("\n");
}

const INDEX_PREVIEW_FIELD_PRIORITY = [
  "代码",
  "名称",
  "指数代码",
  "指数名称",
  "指数中文简称",
  "日期",
  "最新价",
  "收盘",
  "收盘指数",
  "涨跌幅",
  "涨跌额",
  "成交量",
  "成交额",
  "开盘",
  "最高",
  "最低",
  "权重",
];

function formatSignedPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
