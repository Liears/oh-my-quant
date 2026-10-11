import { isDeepStrictEqual } from "node:util";
import { comparePortfolios } from "../quant/portfolio-comparison.ts";
import { comparisonMethodNotes } from "../quant/portfolio-comparison-notes.ts";
import { normalizeSymbol, inferMarket } from "../market/symbols.ts";
import { validateDateRange } from "../market/bars.ts";
import { fetchBars, fetchComparisonFx } from "../source/index.ts";
import { loadPanelPortfolio, readSettings, loadCachedBars, saveBars, savePortfolioComparison, loadPortfolioComparison } from "../storage/index.ts";
import { createStorageSourceProviderOptions } from "./source-runtime.ts";
import { loadFundDcaData } from "./fund-data.ts";
import { findPortfolioGroup } from "./portfolio.ts";
import type { ComparisonPrice, PortfolioComparisonInput, PortfolioComparisonResult, PortfolioComparisonRequest } from "../types/portfolio-comparison.ts";

export type { PortfolioComparisonRequest } from "../types/portfolio-comparison.ts";
export interface PortfolioComparisonDeps {
  portfolio: typeof loadPanelPortfolio;
  price: (symbol: string, currency: string, start: string, end: string, signal?: AbortSignal) => Promise<ComparisonPrice>;
  fx: typeof fetchComparisonFx;
  save: typeof savePortfolioComparison;
}

/** Freeze settings for the whole request, including members fetched after other members finish. */
export function createPortfolioComparisonDeps(): PortfolioComparisonDeps {
  const settings = readSettings(), providers = createStorageSourceProviderOptions(settings);
  return { portfolio: loadPanelPortfolio, fx: fetchComparisonFx, save: savePortfolioComparison,
    async price(symbol, currency, start, end, signal) {
      if (symbol.endsWith(".OF")) {
        const data = await loadFundDcaData(symbol, false, signal);
        return { symbol, currency, points: data.nav.filter(row => row.navDate >= start && row.navDate <= end).map(row => ({ date: row.navDate, price: row.unitNav })),
          source: "akshare", origin: "provider", observedAt: data.dataset?.snapshotAt ?? new Date().toISOString(), ...(data.dataset ? { dataset: data.dataset } : {}) };
      }
      const data = await fetchBars(symbol, inferMarket(symbol), start, end, undefined, { providers: { ...providers, signal },
        deps: { loadCache: loadCachedBars, saveBars, getPreferredSource: () => settings.preferences.source } });
      if (data.origin === "unavailable" && data.attempts.some(attempt => attempt.status === "error")) throw new Error(`Could not fetch ${symbol}; check data provider connectivity and permissions. No comparison saved.`);
      return { symbol, currency, points: data.bars.map(row => ({ date: row.date, price: row.close })), source: data.source,
        origin: data.origin, observedAt: data.dataset?.snapshotAt ?? (data.origin === "provider" ? new Date().toISOString() : "unknown"), ...(data.dataset ? { dataset: data.dataset } : {}) };
    } };
}

/** Snapshot observation groups; comparison never edits preferences. Currency assignments are explicit hypotheses. */
export async function runPortfolioComparison(request: PortfolioComparisonRequest, signal?: AbortSignal, deps?: PortfolioComparisonDeps) {
  signal?.throwIfAborted();
  const input = structuredClone(request);
  // Null slots survive JSON round trips, including the tool's omitted per-group weights.
  input.weights = [input.weights?.[0] ?? null, input.weights?.[1] ?? null];
  validateDateRange(input.start, input.end);
  if (!input.start || !input.end || input.start === input.end || !/^[A-Z]{3}$/.test(input.baseCurrency)) throw new Error("Specify a nonzero date window and uppercase base currency.");
  if (input.groups.length !== 2 || !["buy-and-hold", "rebalance"].includes(input.weighting) || !["fail", "exclude"].includes(input.missingMembers)) throw new Error("Invalid comparison selection or method.");
  const ports = deps ?? createPortfolioComparisonDeps(), snapshot = structuredClone(ports.portfolio());
  const canonical = (code: string) => normalizeSymbol(snapshot.symbols.find(item => item.code === code)?.instrument === "fund" && /^\d{6}$/.test(code) ? `${code}.OF` : code);
  const groups = input.groups.map((key, index) => {
    const group = findPortfolioGroup(snapshot, key), members = group.symbolCodes.map(canonical);
    if (!members.length || new Set(members).size !== members.length) throw new Error(`Portfolio ${group.name} is empty or contains duplicate canonical symbols.`);
    const entries = input.weights?.[index] ? Object.entries(input.weights[index]!).map(([symbol, weight]) => [canonical(symbol), weight] as const) : undefined;
    if (entries && (entries.length !== members.length || new Set(entries.map(([symbol]) => symbol)).size !== entries.length
      || entries.some(([symbol, weight]) => !members.includes(symbol) || !Number.isFinite(weight) || weight <= 0)
      || Math.abs(entries.reduce((sum, [, weight]) => sum + weight, 0) - 1) > 1e-9)) throw new Error(`Weights for ${group.name} must cover each member and sum to 1.`);
    return { id: group.id, name: group.name, members, ...(entries ? { weights: Object.fromEntries(entries) } : {}) };
  }) as PortfolioComparisonInput["groups"];
  if (groups[0].id === groups[1].id) throw new Error("Choose two different portfolios.");
  const benchmark = canonical(input.benchmark), symbols = [...new Set([...groups.flatMap(group => group.members), benchmark])];
  const currencies = new Map<string, string>();
  for (const [code, currency] of Object.entries(input.currencies)) {
    const symbol = canonical(code);
    if (currencies.has(symbol) || !/^[A-Z]{3}$/.test(currency) || !symbols.includes(symbol)) throw new Error(`Invalid or duplicate quote currency assignment: ${code}`);
    currencies.set(symbol, currency);
  }
  const missing = symbols.filter(symbol => !currencies.has(symbol));
  if (missing.length) throw new Error(`Specify quote currencies for ${missing.join(", ")}; currencies are not inferred from exchanges.`);
  const controller = new AbortController(), requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const prices: ComparisonPrice[] = new Array(symbols.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(4, symbols.length) }, async () => {
    while (next < symbols.length) {
      requestSignal.throwIfAborted();
      const index = next++, symbol = symbols[index]!, currency = currencies.get(symbol)!;
      try {
        const price = await ports.price(symbol, currency, input.start, input.end, requestSignal);
        requestSignal.throwIfAborted();
        if (price.symbol !== symbol || price.currency !== currency) throw new Error(`Price identity mismatch: ${symbol}`);
        prices[index] = price;
      } catch (error) {
        requestSignal.throwIfAborted();
        // Transport/provider failures are not valid missing-member exclusions. Preserve failure rather than silently changing the portfolio.
        controller.abort(error); throw error;
      }
    }
  });
  const settled = await Promise.allSettled(workers);
  const failure = settled.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  requestSignal.throwIfAborted();
  const fxCurrencies = prices.filter(price => price.points.filter(point => point.date >= input.start && point.date <= input.end).length >= 2).map(price => price.currency);
  const fx = await ports.fx(input.baseCurrency, fxCurrencies, input.start, input.end, { signal: requestSignal });
  requestSignal.throwIfAborted();
  const result = comparePortfolios({ request: input, groups, benchmark, start: input.start, end: input.end, baseCurrency: input.baseCurrency,
    weighting: input.weighting, missingMembers: input.missingMembers, prices, fx, portfolioRevision: snapshot.revision ?? "missing" });
  requestSignal.throwIfAborted();
  return ports.save(result);
}

export function restorePortfolioComparison(id: string) {
  const artifact = loadPortfolioComparison(id);
  if (!isDeepStrictEqual(comparePortfolios(artifact.result.input, artifact.result.methodVersion), artifact.result)) throw new Error("Saved comparison does not match its recorded inputs.");
  return artifact;
}

export function formatPortfolioComparison(result: PortfolioComparisonResult): string {
  const percent = (value: number | null) => value === null ? "N/A" : `${(value * 100).toFixed(2)}%`;
  return [`Comparison · ${result.input.baseCurrency} · ${result.input.weighting}`, `Requested: ${result.input.start} → ${result.input.end}`,
    `Common valuations: ${result.dates[0]} → ${result.dates.at(-1)} · ${result.dates.length} dates`,
    ...[...result.groups, result.benchmark].map(curve => `${curve.name}: return ${percent(curve.totalReturn)} · CAGR ${percent(curve.cagr)} · Sharpe ${curve.sharpe?.toFixed(2) ?? "N/A"} · max drawdown ${percent(curve.maxDrawdown)} · excess ${percent(curve.excessReturn)}`),
    ...[...result.groups, result.benchmark].map(curve => `${curve.name} risk: annual vol ${percent(curve.risk?.annualVol ?? null)} · downside vol ${percent(curve.risk?.downsideVol ?? null)} · VaR95 ${percent(curve.risk?.var95 ?? null)} · CVaR95 ${percent(curve.risk?.cvar95 ?? null)}`),
    ...result.groups.map(group => `${group.name} initial weights: ${group.members.map(member => `${member.symbol} ${percent(member.initialWeight)} (${member.currency}; local ${percent(member.localReturn)}, base ${percent(member.baseReturn)})`).join(", ")}`),
    `Excluded members: ${result.excludedMembers.map(item => `${item.symbol} (${item.reason})`).join("; ") || "none"}`,
    `Dropped dates: ${result.droppedDates.map(item => `${item.date} [${item.missing.join(", ")}]`).join("; ") || "none"}`,
    ...result.input.prices.map(price => `${price.symbol}: ${price.source} · ${price.origin} · latest price ${price.points.map(point => point.date).sort().at(-1) ?? "none"} · observed ${price.observedAt}`),
    `FX: ${result.input.fx.source} · ${result.input.fx.observedAt} · same date only; quote currencies are explicit research assumptions.`,
    ...comparisonMethodNotes(result)].join("\n");
}
