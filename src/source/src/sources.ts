/**
 * Market source facade — cache-aware fetch orchestration over direct providers.
 */

import { normalizeSymbol } from "../../market/symbols.ts";
import { validateDateRange } from "../../market/bars.ts";
import { validateObservationCutoff } from "../../market/observation-cutoff.ts";
import { SOURCE_LABELS } from "./source-contracts.ts";
import { ProviderBudget } from "./provider-budget.ts";
import { fallbackSourceForMarket, normalizeBarSeries, providerOrderFor, pullBarsFromProviders } from "./source-providers.ts";
import type { Bar, CachedBars, Market } from "../../types/data.ts";
import type { BarsFetchResult, DataSource, LiveBarsFetchResult, ProviderAttempt, PullSource, SourceFetchOptions, SourceRuntimeDeps } from "./source-contracts.ts";

export { SOURCE_LABELS } from "./source-contracts.ts";
export { normalizeBarSeries, providerOrderFor, pullBarsFromProviders, searchSymbols } from "./source-providers.ts";
export type {
  BarsFetchResult,
  BarProviderAdapter,
  DataSource,
  LiveFetchResult,
  LiveBarsFetchResult,
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

/** Fetch daily bars. Auto may use a fresh cache; explicit source still checks caches for offline fallback. */
export async function fetchBars(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  source?: DataSource,
  options: SourceFetchOptions = {},
): Promise<BarsFetchResult> {
  options.providers?.signal?.throwIfAborted();
  validateDateRange(start, end);
  symbol = normalizeSymbol(symbol, market);
  const deps = options.deps ?? defaultSourceRuntimeDeps();
  const explicit = source && source !== "auto";
  if (options.observedBefore !== undefined) {
    const selected = source && source !== "auto" ? source : await deps.getPreferredSource(market, options.providers?.signal);
    const order = providerOrderFor(market, selected, options.providers?.fallbackOrder);
    const boundary = validateObservationCutoff(options.observedBefore);
    for (const src of order) {
      options.providers?.signal?.throwIfAborted();
      const archive = await deps.loadArchiveBefore?.(symbol, src, start, end, options.observedBefore, options.providers?.signal);
      options.providers?.signal?.throwIfAborted();
      const rows = normalizeBarSeries(archive?.bars ?? [], start, end), ref = archive?.dataset;
      if (!rows.length || !ref || ref.availability !== "observed-at-fetch" || !Number.isFinite(Date.parse(ref.snapshotAt))
        || Date.parse(ref.snapshotAt) > boundary || ref.requested.start !== (start ?? null) || ref.requested.end !== (end ?? null)
        || ref.dates.length !== rows.length || ref.dates.some((date, index) => date !== rows[index]?.date)) continue;
      return { bars: rows, source: src, origin: "cache", asOfDate: rows.at(-1)!.date, attempts: [], dataset: ref,
        adjustment: ref.adjustment,
        observationAt: ref.snapshotAt, historicalBoundary: { observedBefore: options.observedBefore, evidence: "app-archive" },
        ...(ref.providerEndpoint ? { providerEndpoint: ref.providerEndpoint } : {}),
        turnoverSemantics: archive?.turnoverSemantics ?? "legacy-unknown" };
    }
    return { bars: [], source: "unavailable", origin: "unavailable", asOfDate: "", attempts: [],
      historicalBoundary: { observedBefore: options.observedBefore, evidence: "unavailable" } };
  }
  const budget = new ProviderBudget(options.providers?.signal, options.providers?.budgetMs);
  let stale: BarsFetchResult | undefined;
  let attempts: ProviderAttempt[] = [];
  try {
    const selected = source && source !== "auto" ? source
      : await budget.run(() => Promise.resolve(deps.getPreferredSource(market, budget.signal)));
    const order = providerOrderFor(market, selected, options.providers?.fallbackOrder);
    if (budget.exhausted) return timedOutResult(stale, attempts);
    // Inspect compatible caches once before a potentially slow provider chain.
    // Explicit source bypasses a fresh hit, but keeps it available as a visible stale fallback.
    for (const src of order) {
      const cache = await budget.run(() => deps.loadCache(symbol, src, start, end, budget.signal));
      const cached = normalizeBarSeries(cache.bars, start, end);
      if (cached.length > 0) {
        const candidate = cachedResult(src, cache, cached, "stale-cache");
        stale ??= candidate;
        if (!explicit && cache.fresh && !budget.exhausted) return { ...candidate, origin: "cache" };
      }
      if (budget.exhausted) return timedOutResult(stale, attempts);
    }

    const pulled = await pullBarsFromProviders(symbol, market, start, end, selected, options.providers, budget);
    attempts = pulled.attempts;
    if (pulled.budgetExhausted || budget.exhausted) return timedOutResult(stale, attempts);
    if (pulled.bars.length > 0) {
      const dataset = await budget.run(() => pulled.adjustment
        ? deps.saveBars(symbol, pulled.source, pulled.bars, start, end, budget.signal, pulled.providerEndpoint, pulled.adjustment)
        : pulled.providerEndpoint ? deps.saveBars(symbol, pulled.source, pulled.bars, start, end, budget.signal, pulled.providerEndpoint)
        : deps.saveBars(symbol, pulled.source, pulled.bars, start, end, budget.signal));
      if (budget.exhausted) return dataset ? { ...pulled, origin: "provider", asOfDate: pulled.bars.at(-1)!.date,
        turnoverSemantics: "nullable", dataset, budgetExhausted: true } : timedOutResult(stale, attempts);
      return { ...pulled, origin: "provider", asOfDate: pulled.bars.at(-1)!.date, turnoverSemantics: "nullable", ...(dataset ? { dataset } : {}) };
    }

    // A concurrent writer may have populated a cache during the provider attempts.
    let concurrent: BarsFetchResult | undefined;
    for (const src of order) {
      const cache = await budget.run(() => deps.loadCache(symbol, src, start, end, budget.signal));
      const cached = normalizeBarSeries(cache.bars, start, end);
      if (cached.length > 0) concurrent ??= cachedResult(src, cache, cached, "stale-cache");
      if (budget.exhausted) return timedOutResult(concurrent ?? stale, attempts);
    }
    return concurrent || stale ? { ...(concurrent ?? stale!), attempts } : { ...pulled, origin: "unavailable", asOfDate: "" };
  } catch (error) {
    options.providers?.signal?.throwIfAborted();
    if (!budget.exhausted) throw error;
    return timedOutResult(stale, attempts);
  } finally { budget.close(); }
}

function cachedResult(source: PullSource, cache: CachedBars, bars: Bar[], origin: "cache" | "stale-cache"): BarsFetchResult {
  return { bars, source, origin, asOfDate: bars.at(-1)!.date, attempts: [], dataset: cache.dataset,
    ...(cache.dataset ? { adjustment: cache.dataset.adjustment } : {}),
    ...(cache.dataset?.providerEndpoint ? { providerEndpoint: cache.dataset.providerEndpoint } : {}),
    turnoverSemantics: cache.turnoverSemantics ?? "legacy-unknown" };
}

function timedOutResult(stale: BarsFetchResult | undefined, attempts: ProviderAttempt[]): BarsFetchResult {
  return stale ? { ...stale, attempts, budgetExhausted: true } :
    { bars: [], source: "unavailable", origin: "unavailable", asOfDate: "", attempts, budgetExhausted: true };
}

/** Live provider pull for TUI quotes — never reads or writes `.ohquant/data` cache. */
export async function fetchLiveBars(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  options: Pick<SourceFetchOptions, "deps" | "providers"> = {},
): Promise<LiveBarsFetchResult> {
  options.providers?.signal?.throwIfAborted();
  validateDateRange(start, end);
  const deps = options.deps ?? defaultSourceRuntimeDeps();
  const budget = new ProviderBudget(options.providers?.signal, options.providers?.budgetMs);
  try {
    const selected = await budget.run(() => Promise.resolve(deps.getPreferredSource(market, budget.signal)));
    const pulled = await pullBarsFromProviders(symbol, market, start, end, selected, options.providers, budget);
    const bars = filterBarsByDate(pulled.bars, start, end);
    if (bars.length > 0 && !budget.exhausted) {
      return { bars, source: pulled.source, asOfDate: bars[bars.length - 1].date, attempts: pulled.attempts, window: "requested",
        ...(pulled.adjustment ? { adjustment: pulled.adjustment } : {}),
        ...(pulled.providerEndpoint ? { providerEndpoint: pulled.providerEndpoint } : {}) };
    }

    if ((start || end) && !pulled.budgetExhausted && !budget.exhausted && pulled.attempts.some(attempt => attempt.status === "empty")) {
      const fallback = await pullBarsFromProviders(symbol, market, undefined, undefined, selected, options.providers, budget);
      const attempts = [...pulled.attempts, ...fallback.attempts];
      if (fallback.bars.length > 0 && !budget.exhausted) {
        return {
          bars: fallback.bars,
          source: fallback.source,
          asOfDate: fallback.bars[fallback.bars.length - 1]?.date || "",
          attempts, window: "latest-available",
          ...(fallback.adjustment ? { adjustment: fallback.adjustment } : {}),
          ...(pulled.budgetExhausted || fallback.budgetExhausted ? { budgetExhausted: true } : {}),
          ...(fallback.providerEndpoint ? { providerEndpoint: fallback.providerEndpoint } : {}),
        };
      }
      return { bars: [], source: fallback.source, asOfDate: "", attempts, window: "unavailable",
        ...(pulled.budgetExhausted || fallback.budgetExhausted || budget.exhausted ? { budgetExhausted: true } : {}) };
    }

    return { bars: [], source: pulled.source, asOfDate: "", attempts: pulled.attempts, window: "unavailable",
      ...(pulled.budgetExhausted || budget.exhausted ? { budgetExhausted: true } : {}) };
  } finally { budget.close(); }
}

function defaultSourceRuntimeDeps(): SourceRuntimeDeps {
  return {
    loadCache: async () => ({ bars: [], fresh: false }),
    saveBars: async () => {},
    getPreferredSource: fallbackSourceForMarket,
  };
}

// --- Helpers ---

export function filterBarsByDate(bars: Bar[], start?: string, end?: string): Bar[] {
  return normalizeBarSeries(bars, start, end);
}
