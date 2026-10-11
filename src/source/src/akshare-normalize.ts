import type { Bar, FundNavDaily } from "../../types/data.ts";
import { AKSHARE_PUBLIC_FUND_ENDPOINT_SET, AKSHARE_PUBLIC_INDEX_ENDPOINT_SET } from "./akshare-endpoints.ts";
import {
  AKSHARE_BAR_SOURCE_ENDPOINTS,
  AKSHARE_KNOWN_A_INDEX_SYMBOLS,
  DEFAULT_AKSHARE_BAR_SOURCE_PRIORITY,
} from "./akshare-endpoints.ts";
import type { AksharePublicFundEndpoint, AksharePublicIndexEndpoint } from "./akshare-endpoints.ts";
import type {
  AkshareAttempt,
  AkshareBarInstrument,
  AkshareBarSource,
  AkshareBarsResult,
  AkshareFundHistory,
  AkshareIndexConstituent,
  AkshareIndexConstituentEndpoint,
  AkshareIndexInfoRow,
  AkshareIndexQuote,
  AkshareIndexRowsResult,
  AkshareRowsResult,
  FundAchievementRow,
  FundRiskAnalysisRow,
} from "./akshare-types.ts";

export function parseAkshareJson(parsed: unknown): Bar[] {
  return parseAkshareBarsResultJson(parsed).bars;
}

export function parseAkshareBarsResultJson(parsed: unknown): AkshareBarsResult {
  const record = isRecord(parsed) ? parsed : null;
  if (record?.error) throw new Error(`AKShare error: ${String(record.error)}`);
  const rows = Array.isArray(parsed) ? parsed : record && Array.isArray(record.bars) ? record.bars : null;
  if (!rows) throw new Error("AKShare error: invalid bars payload");
  const bars = rows.filter(isRecord).map((r) => ({
    date: String(r.date || ""),
    open: Number(r.open || 0),
    high: Number(r.high || 0),
    low: Number(r.low || 0),
    close: Number(r.close || 0),
    volume: Number(r.volume || 0),
    amount: r.amount == null || r.amount === "" ? null : Number(r.amount),
  }));
  return {
    bars,
    endpoint: record?.endpoint == null ? null : String(record.endpoint),
    attempts: record && Array.isArray(record.attempts)
      ? record.attempts.filter(isRecord).map(normalizeAttempt)
      : [],
  };
}

export function normalizeAkshareBarSourcePriority(value?: string | readonly string[]): AkshareBarSource[] {
  const tokens = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，>、\s]+/u) : [];
  const aliases: Record<string, AkshareBarSource> = {
    eastmoney: "eastmoney", em: "eastmoney", "东方财富": "eastmoney", "东财": "eastmoney",
    sina: "sina", "新浪": "sina",
    tencent: "tencent", tx: "tencent", "腾讯": "tencent",
  };
  for (const [source, endpoint] of Object.entries(AKSHARE_BAR_SOURCE_ENDPOINTS)) {
    aliases[endpoint] = source as AkshareBarSource;
  }
  const normalized: AkshareBarSource[] = [];
  for (const token of tokens) {
    const source = aliases[String(token).trim().toLowerCase()];
    if (source && !normalized.includes(source)) normalized.push(source);
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_AKSHARE_BAR_SOURCE_PRIORITY];
}

export function classifyAkshareBarSymbol(symbol: string): AkshareBarInstrument {
  const normalized = symbol.trim().toUpperCase();
  if (AKSHARE_KNOWN_A_INDEX_SYMBOLS[normalized]) return "index";
  if (normalized.endsWith(".OF")) return "fund";
  if (/\.(?:SH|SZ|BJ)$/u.test(normalized)) return "stock";
  if (/^\d{6}$/u.test(normalized)) return "ambiguous";
  return "stock";
}

export function parseAkshareFundHistoryJson(parsed: unknown): AkshareFundHistory {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AKShare fund history error: invalid payload");
  }
  const record = parsed as Record<string, unknown>;
  if (record.error) throw new Error(`AKShare fund history error: ${String(record.error)}`);

  const nav = Array.isArray(record.nav)
    ? record.nav.map((row) => normalizeFundNav(row as Record<string, unknown>)).filter((row): row is FundNavDaily => Boolean(row))
    : [];

  return {
    symbol: String(record.symbol || ""),
    fetchedAt: String(record.fetched_at || ""),
    nav,
    profile: isRecord(record.profile) ? record.profile : {},
    rank: isRecord(record.rank) ? record.rank : {},
    purchase: isRecord(record.purchase) ? record.purchase : {},
    achievement: Array.isArray(record.achievement)
      ? record.achievement.map((row) => normalizeAchievement(row as Record<string, unknown>))
      : [],
    analysis: Array.isArray(record.analysis)
      ? record.analysis.map((row) => normalizeRiskAnalysis(row as Record<string, unknown>))
      : [],
    attempts: Array.isArray(record.attempts)
      ? record.attempts.map((row) => normalizeAttempt(row as Record<string, unknown>))
      : [],
  };
}

export function parseAkshareRowsJson(parsed: unknown): AkshareRowsResult {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AKShare rows error: invalid payload");
  }
  const record = parsed as Record<string, unknown>;
  if (record.error) throw new Error(`AKShare rows error: ${String(record.error)}`);
  const endpoint = String(record.endpoint || "");
  if (!AKSHARE_PUBLIC_FUND_ENDPOINT_SET.has(endpoint)) {
    throw new Error(`AKShare rows error: unsupported endpoint ${endpoint}`);
  }
  const rows = Array.isArray(record.rows)
    ? record.rows.filter(isRecord).map((row) => ({ ...row }))
    : [];
  return {
    endpoint: endpoint as AksharePublicFundEndpoint,
    params: isRecord(record.params) ? record.params : {},
    fetchedAt: String(record.fetched_at || ""),
    rowCount: numberOrNull(record.row_count) ?? rows.length,
    rows,
  };
}

export function parseAkshareIndexRowsJson(parsed: unknown): AkshareIndexRowsResult {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AKShare index rows error: invalid payload");
  }
  const record = parsed as Record<string, unknown>;
  if (record.error) throw new Error(`AKShare index rows error: ${String(record.error)}`);
  const endpoint = String(record.endpoint || "");
  if (!AKSHARE_PUBLIC_INDEX_ENDPOINT_SET.has(endpoint)) {
    throw new Error(`AKShare index rows error: unsupported endpoint ${endpoint}`);
  }
  const rows = Array.isArray(record.rows)
    ? record.rows.filter(isRecord).map((row) => ({ ...row }))
    : [];
  return {
    endpoint: endpoint as AksharePublicIndexEndpoint,
    params: isRecord(record.params) ? record.params : {},
    fetchedAt: String(record.fetched_at || ""),
    rowCount: numberOrNull(record.row_count) ?? rows.length,
    rows,
  };
}

export function normalizeAkshareIndexQuote(row: Record<string, unknown>): AkshareIndexQuote | null {
  const rawCode = textOrEmpty(row["代码"] ?? row.code ?? row["指数代码"]);
  const code = rawCode.replace(/^(sh|sz|bj)/iu, "").trim();
  const name = textOrEmpty(row["名称"] ?? row.name ?? row["指数名称"] ?? row["指数中文简称"] ?? row["指数简称"]);
  const price = numberOrNull(row["最新价"] ?? row.latest ?? row["收盘点位"] ?? row["收盘指数"] ?? row["收盘"]);
  if (!code || !name || price == null) return null;
  return {
    code,
    name,
    price,
    change: numberOrNull(row["涨跌额"] ?? row["涨跌"] ?? row["变化值"]),
    changePct: numberOrNull(row["涨跌幅"] ?? row["日涨跌幅"] ?? row["变化幅度"]),
    open: numberOrNull(row["今开"] ?? row["今开盘"] ?? row["开盘价"] ?? row["开盘"]),
    high: numberOrNull(row["最高"] ?? row["最高价"]),
    low: numberOrNull(row["最低"] ?? row["最低价"]),
    prevClose: numberOrNull(row["昨收"] ?? row["昨收盘"] ?? row["昨收价"]),
    volume: numberOrNull(row["成交量"]),
    amount: numberOrNull(row["成交额"] ?? row["成交金额"]),
    category: textOrEmpty(row._category) || undefined,
    source: "akshare",
  };
}

export function normalizeAkshareIndexQuotes(rows: Record<string, unknown>[]): AkshareIndexQuote[] {
  return rows.map(normalizeAkshareIndexQuote).filter((row): row is AkshareIndexQuote => Boolean(row));
}

export function normalizeAkshareIndexInfoRow(row: Record<string, unknown>): AkshareIndexInfoRow | null {
  const indexCode = normalizeSecurityCode(firstValue(row, ["index_code", "指数代码", "代码"]));
  const displayName = textOrEmpty(firstValue(row, ["display_name", "指数名称", "指数中文简称", "名称", "指数简称"]));
  if (!indexCode || !displayName) return null;
  return {
    indexCode,
    displayName,
    publishDate: textOrEmpty(firstValue(row, ["publish_date", "发布日期", "发布日"])) || null,
  };
}

export function normalizeAkshareIndexInfoRows(
  rows: Record<string, unknown>[],
  options: { keyword?: string; limit?: number } = {},
): AkshareIndexInfoRow[] {
  const byCode = new Map<string, AkshareIndexInfoRow>();
  for (const row of rows) {
    const normalized = normalizeAkshareIndexInfoRow(row);
    if (!normalized) continue;
    byCode.set(`${normalized.indexCode}:${normalized.displayName}`, normalized);
  }
  const keyword = textOrEmpty(options.keyword).toLowerCase();
  const filtered = [...byCode.values()].filter((row) => {
    if (!keyword) return true;
    return [row.indexCode, row.displayName, row.publishDate].some((value) => textOrEmpty(value).toLowerCase().includes(keyword));
  });
  const limit = positiveLimit(options.limit);
  return limit == null ? filtered : filtered.slice(0, limit);
}

export function normalizeAkshareIndexConstituentRow(
  row: Record<string, unknown>,
  options: { symbol: string; indexName?: string | null; source: AkshareIndexConstituentEndpoint },
): AkshareIndexConstituent | null {
  const stockCode = normalizeSecurityCode(firstValue(row, ["品种代码", "成分券代码", "证券代码", "股票代码", "样本代码", "stock_code", "code"]));
  const stockName = textOrEmpty(firstValue(row, ["品种名称", "成分券名称", "证券名称", "股票简称", "股票名称", "样本简称", "stock_name", "name"]));
  if (!stockCode || !stockName) return null;
  const indexCode = normalizeSecurityCode(firstValue(row, ["指数代码"])) || normalizeSecurityCode(options.symbol);
  const indexName = textOrEmpty(firstValue(row, ["指数名称", "指数中文简称", "指数中文全称"])) || options.indexName || null;
  return {
    stockCode,
    stockName,
    inclusionDate: textOrEmpty(firstValue(row, ["纳入日期", "计入日期"])) || null,
    indexCode,
    indexName,
    exchange: textOrEmpty(firstValue(row, ["交易所", "交易所英文名称", "market", "exchange"])) || null,
    weight: numberOrNull(firstValue(row, ["权重", "最新权重"])),
    source: options.source,
  };
}

export function normalizeAkshareIndexConstituentRows(
  rows: Record<string, unknown>[],
  options: { symbol: string; indexName?: string | null; source: AkshareIndexConstituentEndpoint },
): AkshareIndexConstituent[] {
  const byStock = new Map<string, AkshareIndexConstituent>();
  for (const row of rows) {
    const normalized = normalizeAkshareIndexConstituentRow(row, options);
    if (!normalized) continue;
    byStock.set(normalized.stockCode, normalized);
  }
  return [...byStock.values()];
}

export function normalizeConstituentSourcePriority(sourcePriority?: string | string[]): AkshareIndexConstituentEndpoint[] {
  const defaults: AkshareIndexConstituentEndpoint[] = ["index_stock_cons_csindex", "index_stock_cons_sina", "index_stock_cons"];
  const aliases: Record<string, AkshareIndexConstituentEndpoint> = {
    csindex: "index_stock_cons_csindex",
    csi: "index_stock_cons_csindex",
    "中证": "index_stock_cons_csindex",
    index_stock_cons_csindex: "index_stock_cons_csindex",
    sina: "index_stock_cons_sina",
    "新浪": "index_stock_cons_sina",
    index_stock_cons_sina: "index_stock_cons_sina",
    legacy: "index_stock_cons",
    sina_legacy: "index_stock_cons",
    "通用": "index_stock_cons",
    index_stock_cons: "index_stock_cons",
  };
  const parts = Array.isArray(sourcePriority)
    ? sourcePriority
    : textOrEmpty(sourcePriority).split(/[\s,>]+/u);
  const picked: AkshareIndexConstituentEndpoint[] = [];
  for (const part of parts) {
    const endpoint = aliases[part.trim().toLowerCase()];
    if (endpoint && !picked.includes(endpoint)) picked.push(endpoint);
  }
  return [...picked, ...defaults.filter((endpoint) => !picked.includes(endpoint))];
}

export function constituentSymbolCandidates(symbol: string, endpoint: AkshareIndexConstituentEndpoint): string[] {
  const candidates = [symbol];
  if ((endpoint === "index_stock_cons_csindex" || endpoint === "index_stock_cons_sina") && /^399\d{3}$/u.test(symbol)) {
    candidates.push(`000${symbol.slice(3)}`);
  }
  if (endpoint === "index_stock_cons_sina" && /^000\d{3}$/u.test(symbol)) {
    candidates.push(`399${symbol.slice(3)}`);
  }
  return [...new Set(candidates)];
}

export function normalizeSecurityCode(value: unknown): string {
  const raw = textOrEmpty(value)
    .replace(/^(sh|sz|bj)/iu, "")
    .replace(/\.(SH|SZ|BJ|SI)$/iu, "")
    .trim();
  const match = raw.match(/\d{6}/u);
  return match?.[0] || raw;
}

export function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const normalized = typeof value === "string" ? value.replace(/,/gu, "").replace(/%$/u, "").trim() : value;
  if (normalized === "" || normalized === "--") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizeFundNav(row: Record<string, unknown>): FundNavDaily | null {
  const navDate = String(row.nav_date || "");
  const unitNav = numberOrNull(row.unit_nav);
  if (!navDate || unitNav == null) return null;
  return {
    fundCode: String(row.fund_code || ""),
    navDate,
    unitNav,
    accumulatedNav: numberOrNull(row.accumulated_nav),
    dailyReturnPct: numberOrNull(row.daily_return_pct),
    isOpenDay: row.is_open_day !== false,
    source: String(row.source || "akshare"),
  };
}

function normalizeAchievement(row: Record<string, unknown>): FundAchievementRow {
  return {
    type: String(row["业绩类型"] || ""),
    period: String(row["周期"] || ""),
    returnPct: numberOrNull(row["本产品区间收益"]),
    maxDrawdownPct: numberOrNull(row["本产品最大回撤"] ?? row["本产品最大回撒"]),
    rank: row["周期收益同类排名"] == null ? null : String(row["周期收益同类排名"]),
  };
}

function normalizeRiskAnalysis(row: Record<string, unknown>): FundRiskAnalysisRow {
  return {
    period: String(row["周期"] || ""),
    riskReturnScore: numberOrNull(row["较同类风险收益比"]),
    antiVolatilityScore: numberOrNull(row["较同类抗风险波动"]),
    annualVolatilityPct: numberOrNull(row["年化波动率"]),
    annualSharpe: numberOrNull(row["年化夏普比率"]),
    maxDrawdownPct: numberOrNull(row["最大回撤"]),
  };
}

function normalizeAttempt(row: Record<string, unknown>): AkshareAttempt {
  const status = row.status === "error" ? "error" : "ok";
  return {
    endpoint: String(row.endpoint || ""),
    status,
    rows: numberOrNull(row.rows) ?? undefined,
    error: row.error == null ? undefined : String(row.error),
  };
}

function firstValue(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value != null && textOrEmpty(value) !== "") return value;
  }
  return undefined;
}

function positiveLimit(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textOrEmpty(value: unknown): string {
  return value == null ? "" : String(value).trim();
}
