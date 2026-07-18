/**
 * Market source facade — cache-aware fetch orchestration over direct providers.
 */

import { SOURCE_LABELS } from "./source-contracts.ts";
import { fallbackSourceForMarket, normalizeBarSeries, pullBarsFromProviders } from "./source-providers.ts";
import type { Bar, Market } from "../../types/data.ts";
import type { DataSource, LiveFetchResult, PullSource, SourceFetchOptions, SourceRuntimeDeps } from "./source-contracts.ts";

export { SOURCE_LABELS } from "./source-contracts.ts";
export { normalizeBarSeries, pullBarsFromProviders, searchSymbols } from "./source-providers.ts";
export type {
  BarProviderAdapter,
  DataSource,
  LiveFetchResult,
  ProviderAttempt,
  PullBarsResult,
  PullSource,
  SourceBarsRequest,
  SourceFetchOptions,
  SourceProviderOptions,
  SourceRuntimeDeps,
} from "./source-contracts.ts";

export function formatSourceLabels(sources: Iterable<PullSource>): string {
  const uniq = [...new Set(sources)].filter((s) => s !== "unavailable");
  if (uniq.length === 0) return SOURCE_LABELS.unavailable;
  return uniq.map((s) => SOURCE_LABELS[s]).join(" + ");
}

/** Local wall-clock time with minute precision for Overview attribution. */
export function formatRefreshMinute(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Fetch daily bars. source="auto" picks best available. Explicit source skips cache. */
export async function fetchBars(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  source?: DataSource,
  options: SourceFetchOptions = {},
): Promise<{ bars: Bar[]; source: string }> {
  const deps = options.deps ?? defaultSourceRuntimeDeps();
  const explicit = source && source !== "auto";
  const selected = source && source !== "auto" ? source : deps.getPreferredSource(market);

  // Cache: only use when auto mode and fresh
  if (!explicit) {
    const fresh = await deps.isCacheFresh(symbol, selected);
    if (fresh) {
      const cached = await deps.loadBars(symbol, selected);
      const filtered = normalizeBarSeries(cached, start, end);
      if (filtered.length > 0) return { bars: filtered, source: selected };
    }
  }

  const pulled = await pullBarsFromProviders(symbol, market, start, end, selected, options.providers);
  if (pulled.bars.length > 0) {
    await deps.saveBars(symbol, pulled.source, pulled.bars);
    return { bars: pulled.bars, source: pulled.source };
  }

  // Last resort: load any cached data
  for (const src of ["akshare", "tushare", "llmquant-data", "financial-datasets"]) {
    const cached = normalizeBarSeries(await deps.loadBars(symbol, src), start, end);
    if (cached.length > 0) return { bars: cached, source: src };
  }

  return { bars: [], source: pulled.source };
}

/** Live provider pull for TUI quotes — never reads or writes `.ohquant/data` cache. */
export async function fetchLiveBars(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  options: Pick<SourceFetchOptions, "deps" | "providers"> = {},
): Promise<LiveFetchResult> {
  const deps = options.deps ?? defaultSourceRuntimeDeps();
  const selected = deps.getPreferredSource(market);
  const pulled = await pullBarsFromProviders(symbol, market, start, end, selected, options.providers);
  const bars = filterBarsByDate(pulled.bars, start, end);
  if (bars.length > 0) {
    return { bars, source: pulled.source, asOfDate: bars[bars.length - 1].date };
  }

  if (start || end) {
    const fallback = await pullBarsFromProviders(symbol, market, undefined, undefined, selected, options.providers);
    if (fallback.bars.length > 0) {
      return {
        bars: fallback.bars,
        source: fallback.source,
        asOfDate: fallback.bars[fallback.bars.length - 1]?.date || "",
      };
    }
  }

  return { bars: [], source: pulled.source, asOfDate: "" };
}

function defaultSourceRuntimeDeps(): SourceRuntimeDeps {
  return {
    loadBars: async () => [],
    saveBars: async () => {},
    isCacheFresh: async () => false,
    getPreferredSource: fallbackSourceForMarket,
  };
}

// --- Helpers ---

export function filterBarsByDate(bars: Bar[], start?: string, end?: string): Bar[] {
  return normalizeBarSeries(bars, start, end);
}
