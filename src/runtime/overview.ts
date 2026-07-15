import { fetchAkshareAIndexSpot, formatRefreshMinute, formatSourceLabels, type PullSource } from "../source/index.ts";
import { fetchLiveBars } from "./source-runtime.ts";
import type { PanelSection } from "../tui/src/types.ts";
import type { Bar } from "../types/data.ts";
import { baseCode, inferMarket, isAIndexSymbol, type MarketSymbol } from "../market/symbols.ts";

export type OverviewSymbolEntry = MarketSymbol & { name: string; instrument?: "fund" | "security" };
export type OverviewQuote = { code: string; name: string; price: number; pct: number };
export type OverviewHolding = { code: string; name: string; price: number; pct: number };

export interface OverviewPullMeta {
  sources: PullSource[];
  asOfDates: string[];
}

export interface OverviewPortfolio {
  symbols: OverviewSymbolEntry[];
  groups?: Array<{ id: string; name: string; symbolCodes: string[] }>;
}

export type OverviewQuoteFetcher = (entries: OverviewSymbolEntry[], meta: OverviewPullMeta) => Promise<OverviewQuote[]>;
export type OverviewHoldingFetcher = (entries: OverviewSymbolEntry[], meta: OverviewPullMeta) => Promise<OverviewHolding[]>;

export const MARKET_INDICES: OverviewSymbolEntry[] = [
  { code: "000001.SH", name: "上证指数" },
  { code: "399001.SZ", name: "深证成指" },
  { code: "000300.SH", name: "沪深300" },
  { code: "000905.SH", name: "中证500" },
  { code: "399006.SZ", name: "创业板指" },
];

export function buildOverviewPanelSections({
  portfolio,
  portfolioSymbols = collectOverviewSymbols(portfolio),
  marketQuotes,
  portfolioRows,
  pullMeta,
  refreshedAt = new Date(),
}: {
  portfolio: OverviewPortfolio;
  portfolioSymbols?: OverviewSymbolEntry[];
  marketQuotes: OverviewQuote[];
  portfolioRows: OverviewHolding[];
  pullMeta: OverviewPullMeta;
  refreshedAt?: Date;
}): PanelSection[] {
  const groups = portfolio.groups ?? [];
  const sections: PanelSection[] = [];
  if (portfolioSymbols.length > 0 || groups.length > 0) {
    sections.push(...buildPortfolioSections(portfolioSymbols, groups, portfolioRows));
  }
  sections.push(buildMarketSection(marketQuotes));
  sections.push(buildSourceSection(pullMeta, refreshedAt));
  return sections;
}

export async function fetchOverviewQuotes(entries: OverviewSymbolEntry[], meta: OverviewPullMeta): Promise<OverviewQuote[]> {
  const realtime = await fetchAIndexSpotQuotes(entries, meta);
  if (realtime) return realtime;
  return fetchQuotesFromBars(entries, meta);
}

export async function fetchOverviewHoldings(entries: OverviewSymbolEntry[], meta: OverviewPullMeta): Promise<OverviewHolding[]> {
  return Promise.all(entries.map(async (entry) => {
    try {
      const bars = await fetchQuoteBars(entry, meta);
      const row = holdingFromBars(entry, bars);
      if (row) return row;
    } catch {
      // Fall through to placeholder row.
    }
    return {
      code: baseCode(entry.code),
      name: entry.name || entry.code,
      price: Number.NaN,
      pct: Number.NaN,
    };
  }));
}

export function collectOverviewSymbols(portfolio: OverviewPortfolio): OverviewSymbolEntry[] {
  const entries = new Map<string, OverviewSymbolEntry>();
  for (const entry of portfolio.symbols) {
    const name = entry.name || entry.code;
    entries.set(entry.code, { code: entry.code, name, instrument: entry.instrument });
    const normalizedCode = baseCode(entry.code);
    if (!entries.has(normalizedCode)) entries.set(normalizedCode, { code: normalizedCode, name, instrument: entry.instrument });
  }
  for (const group of portfolio.groups ?? []) {
    for (const code of group.symbolCodes) {
      const normalizedCode = baseCode(code);
      if (!entries.has(code)) entries.set(code, { code, name: code });
      if (!entries.has(normalizedCode)) entries.set(normalizedCode, { code: normalizedCode, name: code });
    }
  }
  return [...entries.values()];
}

function buildPortfolioSections(
  portfolioSymbols: OverviewSymbolEntry[],
  groups: NonNullable<OverviewPortfolio["groups"]>,
  portfolioRows: OverviewHolding[],
): PanelSection[] {
  const rowsByCode = new Map<string, OverviewHolding>();
  for (const row of portfolioRows) rowsByCode.set(row.code, row);

  const fallbackRows = portfolioSymbols.map((entry) => ({
    code: baseCode(entry.code),
    name: entry.name || entry.code,
    price: Number.NaN,
    pct: Number.NaN,
  }));
  const fallbackByCode = new Map<string, OverviewHolding>();
  for (const row of fallbackRows) fallbackByCode.set(row.code, row);

  const getRow = (code: string): OverviewHolding => {
    const normalizedCode = baseCode(code);
    return rowsByCode.get(code) || rowsByCode.get(normalizedCode) || fallbackByCode.get(code) || fallbackByCode.get(normalizedCode) || {
      code: normalizedCode,
      name: portfolioSymbols.find((symbol) => symbol.code === code || symbol.code === normalizedCode)?.name || code,
      price: Number.NaN,
      pct: Number.NaN,
    };
  };

  if (groups.length > 0) {
    return groups.map((group) => ({
      kind: "group",
      groupId: group.id,
      title: group.name,
      rows: group.symbolCodes.map((code) => getRow(code)),
      collapsed: false,
    }));
  }
  const rows = portfolioRows.length > 0 ? portfolioRows : fallbackRows;
  return [{ kind: "holdings", title: "Portfolio", rows }];
}

function buildMarketSection(marketQuotes: OverviewQuote[]): PanelSection {
  if (marketQuotes.length > 0) return { kind: "quotes", title: "Market", rows: marketQuotes };
  return { kind: "keyvalue", title: "Market", rows: [{ label: "data", value: "unavailable" }] };
}

function buildSourceSection(meta: OverviewPullMeta, refreshedAt: Date): PanelSection {
  const asOfDate = meta.asOfDates.sort().at(-1) ?? refreshedAt.toISOString().slice(0, 10);
  return {
    kind: "keyvalue",
    title: "Source",
    rows: [
      { label: "来源", value: formatSourceLabels(meta.sources) },
      { label: "更新", value: formatRefreshMinute(refreshedAt) },
      { label: "数据", value: asOfDate },
    ],
  };
}

async function fetchQuotesFromBars(entries: OverviewSymbolEntry[], meta: OverviewPullMeta): Promise<OverviewQuote[]> {
  return Promise.all(entries.map(async (entry) => {
    try {
      const bars = await fetchQuoteBars(entry, meta);
      const quote = quoteFromBars(entry, bars);
      if (quote) return quote;
    } catch {
      // Fall through to placeholder row so fixed indices always render.
    }
    return {
      code: baseCode(entry.code),
      name: entry.name || entry.code,
      price: Number.NaN,
      pct: Number.NaN,
    };
  }));
}

async function fetchAIndexSpotQuotes(entries: OverviewSymbolEntry[], meta: OverviewPullMeta): Promise<OverviewQuote[] | null> {
  if (entries.length === 0 || !entries.every((entry) => isAIndexSymbol(entry.code))) return null;
  try {
    const quotes = await fetchAkshareAIndexSpot(["沪深重要指数", "上证系列指数", "深证系列指数", "中证系列指数"]);
    const byCode = new Map(quotes.map((quote) => [quote.code, quote]));
    const rows = entries.map((entry): OverviewQuote | null => {
      const code = baseCode(entry.code);
      const quote = byCode.get(code);
      if (!quote) return null;
      return {
        code,
        name: entry.name || quote.name,
        price: quote.price,
        pct: quote.changePct ?? 0,
      };
    });
    if (rows.some((row) => row === null)) return null;
    meta.sources.push("akshare");
    meta.asOfDates.push(todayLocalDate());
    return rows as OverviewQuote[];
  } catch {
    return null;
  }
}

async function fetchQuoteBars(entry: OverviewSymbolEntry, meta: OverviewPullMeta): Promise<Bar[]> {
  const symbol = overviewProviderSymbol(entry);
  const market = inferMarket(symbol);
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { bars, source, asOfDate } = await fetchLiveBars(symbol, market, start, end);
  meta.sources.push(source);
  if (asOfDate) meta.asOfDates.push(asOfDate);
  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

/** Preserve portfolio instrument semantics before generic source normalization guesses an exchange. */
export function overviewProviderSymbol(entry: OverviewSymbolEntry): string {
  const symbol = entry.code.trim();
  if (entry.instrument !== "fund" || !/^\d{6}$/u.test(symbol)) return symbol;
  // Exchange-traded funds use exchange routes even when stored without a suffix.
  if (/^(?:5\d{5}|159\d{3})$/u.test(symbol)) return symbol;
  return `${symbol}.OF`;
}

function quoteFromBars(entry: OverviewSymbolEntry, bars: Bar[]): OverviewQuote | null {
  if (bars.length < 2) return null;
  const prev = bars[bars.length - 2]!;
  const last = bars[bars.length - 1]!;
  return {
    code: baseCode(entry.code),
    name: entry.name || entry.code,
    price: last.close,
    pct: prev.close ? (last.close - prev.close) / prev.close * 100 : 0,
  };
}

function holdingFromBars(entry: OverviewSymbolEntry, bars: Bar[]): OverviewHolding | null {
  if (bars.length < 2) return null;
  const prev = bars[bars.length - 2]!;
  const last = bars[bars.length - 1]!;
  return {
    code: baseCode(entry.code),
    name: entry.name || entry.code,
    price: last.close,
    pct: prev.close ? (last.close - prev.close) / prev.close * 100 : 0,
  };
}

function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
