import { fetchFromAKShare } from "./akshare.ts";
import { fetchFromFinancialDatasets } from "./financial-datasets.ts";
import { fetchFromLlmQuant } from "./llmquant.ts";
import { fetchFromTushare, searchTushareSymbols } from "./tushare.ts";
import type { Bar, Market, SymbolInfo } from "../../types/data.ts";
import type { DataSource, ProviderSource, PullSource, SourceProviderOptions } from "./source-contracts.ts";

interface BarProviderAdapter {
  id: ProviderSource;
  fetchBars(symbol: string, start: string | undefined, end: string | undefined, options: SourceProviderOptions): Promise<Bar[]>;
}

const BAR_PROVIDER_ADAPTERS: Record<ProviderSource, BarProviderAdapter> = {
  akshare: {
    id: "akshare",
    fetchBars: (symbol, start, end) => fetchFromAKShare(symbol, start, end),
  },
  tushare: {
    id: "tushare",
    fetchBars: (symbol, start, end, options) => fetchFromTushare(symbol, start, end, options.tushare),
  },
  "llmquant-data": {
    id: "llmquant-data",
    fetchBars: (symbol, start, end, options) => fetchFromLlmQuant(symbol, start, end, options.llmquant),
  },
  "financial-datasets": {
    id: "financial-datasets",
    fetchBars: (symbol, start, end, options) => fetchFromFinancialDatasets(symbol, start, end, options.financialDatasets),
  },
};

/** Provider fallback chain for live/cache pulls. */
export async function pullBarsFromProviders(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  selected: DataSource = fallbackSourceForMarket(market),
  providerOptions: SourceProviderOptions = {},
): Promise<{ bars: Bar[]; source: PullSource }> {
  const normalized = normalizeSymbol(symbol, market);
  for (const id of providerOrderFor(market, selected)) {
    const result = await tryProvider(BAR_PROVIDER_ADAPTERS[id], normalized, start, end, providerOptions);
    if (result && result.bars.length > 0) return result;
  }
  return { bars: [], source: "unavailable" };
}

/** Search symbols */
export async function searchSymbols(
  keyword: string,
  market?: Market,
): Promise<SymbolInfo[]> {
  if (market && market !== "A") return [];
  try {
    return await searchTushareSymbols(keyword);
  } catch {
    return [];
  }
}

export function fallbackSourceForMarket(market: Market): DataSource {
  return market === "A" ? "akshare" : "llmquant-data";
}

async function tryProvider(
  provider: BarProviderAdapter,
  symbol: string,
  start: string | undefined,
  end: string | undefined,
  options: SourceProviderOptions,
): Promise<{ bars: Bar[]; source: ProviderSource } | null> {
  try {
    const bars = await provider.fetchBars(symbol, start, end, options);
    return { bars, source: provider.id };
  } catch {
    return null;
  }
}

function providerOrderFor(market: Market, selected: DataSource): ProviderSource[] {
  if (market === "A") {
    return selected === "tushare" ? ["tushare", "akshare"] : ["akshare", "tushare"];
  }

  const order: ProviderSource[] = [];
  const add = (id: ProviderSource) => {
    if (!order.includes(id)) order.push(id);
  };

  if (selected === "llmquant-data" || market === "US" || market === "HK") add("llmquant-data");
  if (selected === "financial-datasets" || market === "US") add("financial-datasets");
  return order;
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
