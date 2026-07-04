import type { Bar } from "../../types/data.ts";
import { loadBars } from "../../storage/index.ts";

const CACHE_SOURCES = ["akshare", "tushare", "llmquant-data", "financial-datasets"] as const;

export type CachedBarsSource = typeof CACHE_SOURCES[number];

export interface CachedBars {
  bars: Bar[];
  source: CachedBarsSource;
}

/** Load bars from any available cache source. Returns null if nothing cached. */
export async function loadCachedBars(symbol: string): Promise<CachedBars | null> {
  for (const source of CACHE_SOURCES) {
    const bars = await loadBars(symbol, source);
    if (bars.length > 0) return { bars, source };
  }
  return null;
}
