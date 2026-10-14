import { normalizeBarSeries, validateDateRange } from "../../market/bars.ts";
import { normalizeSymbol } from "../../market/symbols.ts";
import { isSafeProviderEndpoint } from "../../market/provider-endpoint.ts";
import { isPriceAdjustment } from "../../market/price-adjustment.ts";
import { ProviderBudget } from "./provider-budget.ts";
export { normalizeBarSeries } from "../../market/bars.ts";

import { fetchFromAKShareDetailed } from "./akshare.ts";
import { fetchFromAKShareGlobalDetailed } from "./akshare-global-bars.ts";
import { fetchFromFinancialDatasets } from "./financial-datasets.ts";
import { fetchFromLlmQuant } from "./llmquant.ts";
import { fetchFromTushareDetailed, searchTushareSymbols } from "./tushare.ts";
import type { Bar, Market, PriceAdjustment, SymbolInfo } from "../../types/data.ts";
import type { DailyBarDataset } from "../../types/research-data.ts";
import type {
  BarProviderAdapter,
  DataSource,
  ProviderAttempt,
  ProviderSource,
  PullBarsResult,
  SourceProviderOptions,
} from "./source-contracts.ts";

/** Direct research pull, without cache fallback or inferred finality/adjustment claims. */
export async function fetchResearchBars(
  symbol: string, market: Market, start?: string, end?: string,
  selected: DataSource = fallbackSourceForMarket(market),
  options: SourceProviderOptions = {}, now: () => Date = () => new Date(),
): Promise<{ dataset: DailyBarDataset | null; attempts: ProviderAttempt[] }> {
  validateDateRange(start, end);
  const normalized = normalizeSymbol(symbol, market);
  const budget = new ProviderBudget(options.signal, options.budgetMs);
  const request = { symbol: normalized, market, start, end, signal: budget.signal };
  const adapters = createProviderAdapters(options, budget);
  const attempts: ProviderAttempt[] = [];
  try { for (const source of providerOrderFor(market, selected, options.fallbackOrder)) {
    if (budget.exhausted) break;
    try {
      const adapter = adapters[source];
      const snapshot = adapter.fetchDataset ? await budget.run(() => adapter.fetchDataset!(request)) : null;
      const response = snapshot ?? await budget.run(() => adapter.fetchBars(request));
      const bars = normalizeBarSeries(Array.isArray(response) ? response : response.bars, start, end);
      if (budget.exhausted) throw new Error("Provider request timed out");
      attempts.push({ source, status: bars.length ? "success" : "empty" });
      if (bars.length) return { dataset: {
        symbol: request.symbol, market, source, fetchedAt: now().toISOString(),
        marketAt: snapshot?.marketAt ?? null,
        adjustment: snapshot?.adjustment ?? { basis: "unknown", source: "", verifiedAt: "" },
        finality: snapshot?.finality ?? {},
        units: snapshot?.units ?? { volume: "unknown", amount: "unknown" }, bars,
      }, attempts };
    } catch (error) {
      options.signal?.throwIfAborted();
      attempts.push({ source, status: "error", error: providerErrorMessage(error) });
    }
  } return { dataset: null, attempts }; }
  finally { budget.close(); }
}

/** Provider fallback chain for live/cache pulls. */
export async function pullBarsFromProviders(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  selected: DataSource = fallbackSourceForMarket(market),
  providerOptions: SourceProviderOptions = {},
  sharedBudget?: ProviderBudget,
): Promise<PullBarsResult> {
  validateDateRange(start, end);
  const normalized = normalizeSymbol(symbol, market);
  const attempts: ProviderAttempt[] = [];
  const budget = sharedBudget ?? new ProviderBudget(providerOptions.signal, providerOptions.budgetMs);
  const adapters = createProviderAdapters(providerOptions, budget);
  try {
    for (const id of providerOrderFor(market, selected, providerOptions.fallbackOrder)) {
      if (budget.exhausted) break;
      const result = await tryProvider(id, adapters[id], { symbol: normalized, market, start, end, signal: budget.signal }, budget);
      if (budget.exhausted) {
        attempts.push({ source: id, status: "error", error: "Provider request timed out" });
        break;
      }
      attempts.push(result.attempt);
      if (result.bars.length > 0) return { bars: result.bars, source: id, attempts,
        ...(result.adjustment ? { adjustment: result.adjustment } : {}),
        ...(result.providerEndpoint ? { providerEndpoint: result.providerEndpoint } : {}) };
    }
    return { bars: [], source: "unavailable", attempts, ...(budget.exhausted ? { budgetExhausted: true } : {}) };
  } finally {
    if (!sharedBudget) budget.close();
  }
}

/** Search symbols */
export async function searchSymbols(
  keyword: string,
  market?: Market,
  providerOptions: SourceProviderOptions = {},
): Promise<SymbolInfo[]> {
  providerOptions.signal?.throwIfAborted();
  if (market && market !== "A") return [];
  const budget = new ProviderBudget(providerOptions.signal, providerOptions.budgetMs);
  try {
    const rows = await budget.run(async () => {
      const credentials = await providerOptions.loadCredentials?.(budget.signal);
      if (budget.exhausted) throw budget.signal?.reason;
      return searchTushareSymbols(keyword, { ...credentials?.tushare, ...providerOptions.tushare, signal: budget.signal });
    });
    if (budget.exhausted) throw new Error("Provider request timed out");
    return rows;
  } catch (error) {
    providerOptions.signal?.throwIfAborted();
    throw new Error(providerErrorMessage(error));
  } finally { budget.close(); }
}

export function fallbackSourceForMarket(market: Market): DataSource {
  return market === "A" ? "akshare" : "llmquant-data";
}

async function tryProvider(
  id: ProviderSource,
  provider: BarProviderAdapter,
  request: Parameters<BarProviderAdapter["fetchBars"]>[0],
  budget: ProviderBudget,
): Promise<{ bars: Bar[]; attempt: ProviderAttempt; providerEndpoint?: string; adjustment?: PriceAdjustment }> {
  try {
    const response = await budget.run(() => provider.fetchBars(request));
    const adjustment = Array.isArray(response) ? undefined : response.adjustment;
    if (adjustment !== undefined && !isPriceAdjustment(adjustment)) throw new Error("Provider response invalid: price adjustment");
    const bars = normalizeBarSeries(Array.isArray(response) ? response : response.bars, request.start, request.end);
    const endpoint = Array.isArray(response) ? null : response.endpoint;
    const providerEndpoint = bars.length > 0 && isSafeProviderEndpoint(endpoint) ? endpoint : undefined;
    return { bars, attempt: { source: id, status: bars.length > 0 ? "success" : "empty",
      ...(providerEndpoint ? { providerEndpoint } : {}) }, ...(providerEndpoint ? { providerEndpoint } : {}),
      ...(bars.length && adjustment ? { adjustment } : {}) };
  } catch (error) {
    return { bars: [], attempt: { source: id, status: "error", error: providerErrorMessage(error) } };
  }
}

function createProviderAdapters(options: SourceProviderOptions, budget: ProviderBudget): Record<ProviderSource, BarProviderAdapter> {
  type Credentials = Awaited<ReturnType<NonNullable<SourceProviderOptions["loadCredentials"]>>>;
  let loaded: Promise<Credentials> | undefined;
  const credentials = async (): Promise<Credentials> => {
    loaded ??= Promise.resolve(options.loadCredentials?.(budget.signal) ?? {});
    const snapshot = await loaded;
    if (budget.exhausted) throw budget.signal?.reason;
    return snapshot;
  };
  return {
    akshare: options.adapters?.akshare ?? {
      fetchBars: async ({ symbol, market, start, end, signal }) => {
        const response = market === "A"
          ? await fetchFromAKShareDetailed(symbol, start, end, { ...options.akshare, signal })
          : await fetchFromAKShareGlobalDetailed(symbol, market, start, end, signal);
        // A completed empty endpoint is different from a chain where every endpoint failed.
        // Preserve detailed AKShare receipts for direct callers; classify at the provider boundary.
        if (!response.bars.length && response.attempts.length && response.attempts.every(attempt => attempt.status === "error")) {
          const failures = response.attempts.map(attempt => providerErrorMessage(attempt.error));
          throw new Error(failures.every(failure => failure === failures[0]) ? failures[0] : "Provider request failed");
        }
        return response;
      },
    },
    tushare: options.adapters?.tushare ?? {
      fetchBars: async ({ symbol, start, end, signal }) => fetchFromTushareDetailed(symbol, start, end,
        { ...(await credentials()).tushare, ...options.tushare, signal }),
    },
    "llmquant-data": options.adapters?.["llmquant-data"] ?? {
      fetchBars: async ({ symbol, start, end, signal }) => fetchFromLlmQuant(symbol, start, end,
        { ...(await credentials()).llmquant, ...options.llmquant, signal }),
    },
    "financial-datasets": options.adapters?.["financial-datasets"] ?? {
      fetchBars: async ({ symbol, start, end, signal }) => fetchFromFinancialDatasets(symbol, start, end,
        { ...(await credentials()).financialDatasets, ...options.financialDatasets, signal }),
    },
  };
}

export function providerOrderFor(
  market: Market,
  selected: DataSource,
  overrides?: SourceProviderOptions["fallbackOrder"],
): ProviderSource[] {
  const supported: ProviderSource[] = market === "A" ? ["akshare", "tushare"]
    : market === "US" ? ["llmquant-data", "financial-datasets", "akshare"] : ["llmquant-data", "akshare"];
  const configured = overrides?.[market]?.filter(id => supported.includes(id));
  const fallback = configured?.length ? configured : supported;
  return orderedWithSelectedFirst(supported.includes(selected as ProviderSource) ? selected : "auto", fallback);
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
  // Provider exceptions can contain arbitrary URLs, headers or response bodies.
  // Only bounded categories may enter research errors and Agent/tool text.
  let message: string;
  try { message = error instanceof Error ? error.message : String(error); }
  catch { return "Provider request failed"; }
  const httpStatus = /\bHTTP\s+([1-5]\d{2})\b/i.exec(message)?.[1];
  if (httpStatus) return `HTTP ${httpStatus}`;
  if (/identity mismatch/i.test(message)) return "Provider identity mismatch";
  if (/response truncated/i.test(message)) return "Provider response truncated";
  if (/pagination invalid/i.test(message)) return "Provider pagination invalid";
  if (/response invalid/i.test(message)) return "Provider response invalid";
  if (/invalid.*token|token.*(?:invalid|无效)|认证失败/i.test(message)) return "Provider authentication failed";
  if (/permission|权限|积分不足/i.test(message)) return "Provider permission denied";
  if (/timed?\s*out|timeout/i.test(message)) return "Provider request timed out";
  if (/not configured|missing.*credential/i.test(message)) return "Provider credential not configured";
  if (/No module named|not installed|ENOENT/i.test(message)) return "Provider dependency unavailable";
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|network|offline/i.test(message)) return "Provider connection failed";
  return "Provider request failed";
}
