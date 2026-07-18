import { fetchFromAKShare } from "./akshare.ts";
import { fetchFromFinancialDatasets } from "./financial-datasets.ts";
import { fetchFromLlmQuant } from "./llmquant.ts";
import { fetchFromTushare, searchTushareSymbols } from "./tushare.ts";
import type { Bar, Market, SymbolInfo } from "../../types/data.ts";
import type {
  BarProviderAdapter,
  DataSource,
  ProviderAttempt,
  ProviderSource,
  PullBarsResult,
  SourceProviderOptions,
} from "./source-contracts.ts";

/** Provider fallback chain for live/cache pulls. */
export async function pullBarsFromProviders(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  selected: DataSource = fallbackSourceForMarket(market),
  providerOptions: SourceProviderOptions = {},
): Promise<PullBarsResult> {
  const normalized = normalizeSymbol(symbol, market);
  const adapters = createProviderAdapters(providerOptions);
  const attempts: ProviderAttempt[] = [];
  for (const id of providerOrderFor(market, selected, providerOptions.fallbackOrder)) {
    const result = await tryProvider(id, adapters[id], { symbol: normalized, market, start, end });
    attempts.push(result.attempt);
    if (result.bars.length > 0) return { bars: result.bars, source: id, attempts };
  }
  return { bars: [], source: "unavailable", attempts };
}

/** Search symbols */
export async function searchSymbols(
  keyword: string,
  market?: Market,
  providerOptions: SourceProviderOptions = {},
): Promise<SymbolInfo[]> {
  if (market && market !== "A") return [];
  try {
    return await searchTushareSymbols(keyword, providerOptions.tushare);
  } catch {
    return [];
  }
}

export function fallbackSourceForMarket(market: Market): DataSource {
  return market === "A" ? "akshare" : "llmquant-data";
}

async function tryProvider(
  id: ProviderSource,
  provider: BarProviderAdapter,
  request: Parameters<BarProviderAdapter["fetchBars"]>[0],
): Promise<{ bars: Bar[]; attempt: ProviderAttempt }> {
  try {
    const bars = normalizeBarSeries(await provider.fetchBars(request), request.start, request.end);
    return { bars, attempt: { source: id, status: bars.length > 0 ? "success" : "empty" } };
  } catch (error) {
    return { bars: [], attempt: { source: id, status: "error", error: providerErrorMessage(error) } };
  }
}

function createProviderAdapters(options: SourceProviderOptions): Record<ProviderSource, BarProviderAdapter> {
  return {
    akshare: options.adapters?.akshare ?? {
      fetchBars: ({ symbol, start, end }) => fetchFromAKShare(symbol, start, end, options.akshare),
    },
    tushare: options.adapters?.tushare ?? {
      fetchBars: ({ symbol, start, end }) => fetchFromTushare(symbol, start, end, options.tushare),
    },
    "llmquant-data": options.adapters?.["llmquant-data"] ?? {
      fetchBars: ({ symbol, start, end }) => fetchFromLlmQuant(symbol, start, end, options.llmquant),
    },
    "financial-datasets": options.adapters?.["financial-datasets"] ?? {
      fetchBars: ({ symbol, start, end }) => fetchFromFinancialDatasets(symbol, start, end, options.financialDatasets),
    },
  };
}

function providerOrderFor(
  market: Market,
  selected: DataSource,
  overrides: SourceProviderOptions["fallbackOrder"],
): ProviderSource[] {
  const configured = overrides?.[market];
  if (configured?.length) return orderedWithSelectedFirst(selected, configured);

  if (market === "A") {
    if (selected === "tushare") return ["tushare", "akshare"];
    if (selected === "akshare" || selected === "auto") return ["akshare", "tushare"];
    // Keep a deliberately selected cross-market provider first, then use the
    // two A-share-native adapters as reliable fallbacks.
    return orderedWithSelectedFirst(selected, ["akshare", "tushare"]);
  }

  const order: ProviderSource[] = [];
  const add = (id: ProviderSource) => {
    if (!order.includes(id)) order.push(id);
  };

  if (selected === "llmquant-data" || market === "US" || market === "HK") add("llmquant-data");
  if (selected === "financial-datasets" || market === "US") add("financial-datasets");
  // Financial Datasets can be explicitly selected for HK too; retain the
  // generally available LLMQuant fallback when it has no coverage.
  if (selected === "financial-datasets") add("llmquant-data");
  return order;
}

/** Convert provider output to one deterministic, ascending daily-bar series. */
export function normalizeBarSeries(bars: readonly Bar[], start?: string, end?: string): Bar[] {
  const byDate = new Map<string, Bar>();
  for (const bar of bars) {
    const date = normalizeDate(bar.date);
    const normalized: Bar = {
      ...bar,
      date,
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      volume: Number(bar.volume),
      amount: Number(bar.amount),
    };
    if (!date || !isValidBar(normalized)) continue;
    if (start && date < start) continue;
    if (end && date > end) continue;
    byDate.set(date, normalized);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
}

function isValidBar(bar: Bar): boolean {
  return [bar.open, bar.high, bar.low, bar.close, bar.volume, bar.amount].every(Number.isFinite);
}

function orderedWithSelectedFirst(selected: DataSource, fallback: readonly ProviderSource[]): ProviderSource[] {
  const order: ProviderSource[] = [];
  if (selected !== "auto") order.push(selected);
  for (const id of fallback) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

function providerErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(bearer\s+)[^\s]+/giu, "$1[redacted]")
    .replace(/([?&](?:api[_-]?key|token|key)=)[^&\s]+/giu, "$1[redacted]")
    .replace(/((?:api[_-]?key|token)\s*[:=]\s*)[^\s]+/giu, "$1[redacted]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
}

/** Normalize bare 6-digit Chinese codes to exchange-suffixed format. */
function normalizeSymbol(symbol: string, market: Market): string {
  if (market !== "A") return symbol;
  // Already suffixed
  if (/\.(SH|SZ|BJ|OF)$/i.test(symbol)) return symbol;
  // 6-digit bare code
  if (/^\d{6}$/.test(symbol)) {
    const prefix = symbol.charAt(0);
    // Shanghai: 5xxxxx (funds), 6xxxxx (stocks), 68xxxx (STAR)
    if (prefix === "5" || prefix === "6") return `${symbol}.SH`;
    // Beijing: 8xxxxx, 4xxxxx
    if (prefix === "8" || prefix === "4") return `${symbol}.BJ`;
    // Shenzhen: 0xxxxx (funds), 1xxxxx (funds), 2xxxxx (stocks), 3xxxxx (ChiNext)
    return `${symbol}.SZ`;
  }
  return symbol;
}
