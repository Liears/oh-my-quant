/**
 * AKShare adapter — calls Python akshare via subprocess.
 * Free A-share data, no API key. Preferred default source for A-share pulls.
 */
import type { Bar } from "../../types/data.ts";
import { AKSHARE_PUBLIC_FUND_ENDPOINT_SET, AKSHARE_PUBLIC_INDEX_ENDPOINT_SET } from "./akshare-endpoints.ts";
import type { AksharePublicFundEndpoint, AksharePublicIndexEndpoint } from "./akshare-endpoints.ts";
import {
  constituentSymbolCandidates,
  normalizeAkshareIndexConstituentRows,
  normalizeAkshareIndexInfoRows,
  normalizeAkshareIndexQuotes,
  normalizeConstituentSourcePriority,
  normalizeSecurityCode,
  parseAkshareFundHistoryJson,
  parseAkshareIndexRowsJson,
  parseAkshareJson,
  parseAkshareRowsJson,
} from "./akshare-normalize.ts";
import { runPython } from "./akshare-python.ts";
import { AKSCRIPT, AK_FUND_HISTORY_SCRIPT, AK_GENERIC_FUND_SCRIPT, AK_GENERIC_INDEX_SCRIPT } from "./akshare-scripts.ts";
import type {
  AkshareArtifactReferenceLine,
  AkshareAttempt,
  AkshareFundHistory,
  AkshareIndexConstituentsResult,
  AkshareIndexInfoResult,
  AkshareIndexQuote,
  AkshareIndexRowsResult,
  AkshareRowsResult,
} from "./akshare-types.ts";
import { fetchSinaAIndexSpotQuotes } from "./sina-index-client.ts";

export { AKSHARE_PUBLIC_FUND_ENDPOINTS, AKSHARE_PUBLIC_INDEX_ENDPOINTS } from "./akshare-endpoints.ts";
export type { AksharePublicFundEndpoint, AksharePublicIndexEndpoint } from "./akshare-endpoints.ts";
export {
  normalizeAkshareIndexConstituentRow,
  normalizeAkshareIndexConstituentRows,
  normalizeAkshareIndexInfoRow,
  normalizeAkshareIndexInfoRows,
  normalizeAkshareIndexQuote,
  normalizeAkshareIndexQuotes,
  parseAkshareFundHistoryJson,
  parseAkshareIndexRowsJson,
  parseAkshareJson,
  parseAkshareRowsJson,
} from "./akshare-normalize.ts";
export type {
  AkshareArtifactReferenceLine,
  AkshareAttempt,
  AkshareFundHistory,
  AkshareIndexConstituent,
  AkshareIndexConstituentEndpoint,
  AkshareIndexConstituentsResult,
  AkshareIndexInfoResult,
  AkshareIndexInfoRow,
  AkshareIndexQuote,
  AkshareIndexRowsResult,
  AkshareRowsResult,
  FundAchievementRow,
  FundNavDaily,
  FundRiskAnalysisRow,
} from "./akshare-types.ts";

export async function fetchAkshareIndexInfo(keyword?: string, limit?: number): Promise<AkshareIndexInfoResult> {
  const data = await fetchAkshareIndexRows("index_stock_info");
  const rows = normalizeAkshareIndexInfoRows(data.rows, { keyword, limit });
  return {
    fetchedAt: data.fetchedAt,
    rowCount: data.rowCount,
    rows,
  };
}

export async function fetchAkshareIndexConstituents(
  symbol: string,
  sourcePriority?: string | string[],
): Promise<AkshareIndexConstituentsResult> {
  const normalizedSymbol = normalizeSecurityCode(symbol);
  if (!normalizedSymbol) throw new Error("AKShare index constituents error: symbol is required");

  let indexName: string | null = null;
  try {
    const info = await fetchAkshareIndexInfo(normalizedSymbol);
    indexName = info.rows.find((row) => row.indexCode === normalizedSymbol)?.displayName
      || info.rows[0]?.displayName
      || null;
  } catch {
    indexName = null;
  }

  const attempts: AkshareAttempt[] = [];
  for (const endpoint of normalizeConstituentSourcePriority(sourcePriority)) {
    for (const candidateSymbol of constituentSymbolCandidates(normalizedSymbol, endpoint)) {
      try {
        const data = await fetchAkshareIndexRows(endpoint, { symbol: candidateSymbol });
        const rows = normalizeAkshareIndexConstituentRows(data.rows, { symbol: normalizedSymbol, indexName, source: endpoint });
        attempts.push({ endpoint: `${endpoint}:${candidateSymbol}`, status: "ok", rows: data.rowCount });
        if (rows.length > 0) {
          return {
            symbol: normalizedSymbol,
            indexName: rows[0]?.indexName || indexName,
            fetchedAt: data.fetchedAt,
            source: endpoint,
            constituents: rows,
            attempts,
          };
        }
      } catch (error) {
        attempts.push({ endpoint: `${endpoint}:${candidateSymbol}`, status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return {
    symbol: normalizedSymbol,
    indexName,
    fetchedAt: new Date().toISOString(),
    source: null,
    constituents: [],
    attempts,
  };
}

export async function fetchAkshareIndexRows(
  endpoint: AksharePublicIndexEndpoint,
  params: Record<string, unknown> = {},
): Promise<AkshareIndexRowsResult> {
  if (!AKSHARE_PUBLIC_INDEX_ENDPOINT_SET.has(endpoint)) {
    throw new Error(`Unsupported AKShare index endpoint: ${endpoint}`);
  }
  const { stdout } = await runPython(AK_GENERIC_INDEX_SCRIPT, [endpoint, JSON.stringify(cleanParams(params))], { timeoutMs: 60_000 });
  return parseAkshareIndexRowsJson(JSON.parse(stdout));
}

export async function fetchAkshareAIndexSpot(
  symbol: string | string[] = "沪深重要指数",
): Promise<AkshareIndexQuote[]> {
  const categories = Array.isArray(symbol) ? symbol : [symbol];
  const fallbackQuotes = await fetchSinaAIndexSpotQuotes(categories);
  if (fallbackQuotes.length > 0) return fallbackQuotes;

  const byKey = new Map<string, AkshareIndexQuote>();
  for (const category of categories) {
    const result = await fetchAkshareIndexRows("stock_zh_index_spot_em", { symbol: category });
    for (const quote of normalizeAkshareIndexQuotes(result.rows.map((row) => ({ ...row, _category: category })))) {
      byKey.set(`${quote.code}:${quote.name}`, quote);
    }
  }
  return [...byKey.values()];
}

export async function buildAkshareArtifactReferenceLine(
  symbol: string,
  label: string,
  start?: string,
  end?: string,
): Promise<AkshareArtifactReferenceLine> {
  const bars = await fetchFromAKShare(symbol, start, end);
  return {
    label,
    symbol,
    dates: bars.map((bar) => bar.date),
    closes: bars.map((bar) => bar.close),
    source: "akshare",
  };
}

export async function fetchFromAKShare(
  symbol: string,
  start?: string,
  end?: string,
): Promise<Bar[]> {
  const startDate = start?.replace(/-/g, "") || "20200101";
  const endDate = end?.replace(/-/g, "") || todayYmd();

  const { stdout } = await runPython(AKSCRIPT, [symbol, startDate, endDate]);
  return parseAkshareJson(JSON.parse(stdout));
}

export async function fetchAkshareFundHistory(symbol: string): Promise<AkshareFundHistory> {
  return fetchAkshareFundMode(symbol, "history");
}

export async function fetchAkshareFundNav(symbol: string): Promise<AkshareFundHistory> {
  return fetchAkshareFundMode(symbol, "nav");
}

export async function fetchAkshareFundProfile(symbol: string): Promise<AkshareFundHistory> {
  return fetchAkshareFundMode(symbol, "profile");
}

export async function fetchAkshareFundPurchase(symbol: string): Promise<AkshareFundHistory> {
  return fetchAkshareFundMode(symbol, "purchase");
}

export async function fetchAkshareFundPerformance(symbol: string): Promise<AkshareFundHistory> {
  return fetchAkshareFundMode(symbol, "performance");
}

export async function fetchAkshareRows(
  endpoint: AksharePublicFundEndpoint,
  params: Record<string, unknown> = {},
): Promise<AkshareRowsResult> {
  if (!AKSHARE_PUBLIC_FUND_ENDPOINT_SET.has(endpoint)) {
    throw new Error(`Unsupported AKShare public fund endpoint: ${endpoint}`);
  }
  const { stdout } = await runPython(AK_GENERIC_FUND_SCRIPT, [endpoint, JSON.stringify(cleanParams(params))], { timeoutMs: 60_000 });
  return parseAkshareRowsJson(JSON.parse(stdout));
}

async function fetchAkshareFundMode(symbol: string, mode: "history" | "nav" | "profile" | "purchase" | "performance"): Promise<AkshareFundHistory> {
  const { stdout } = await runPython(AK_FUND_HISTORY_SCRIPT, [symbol, mode], { timeoutMs: 60_000 });
  return parseAkshareFundHistoryJson(JSON.parse(stdout));
}

function cleanParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value != null && value !== ""),
  );
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
