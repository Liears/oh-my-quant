/** Daily OHLCV bar */
export interface Bar {
  date: string;     // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Turnover reported by the provider; null when it did not supply one. */
  amount: number | null;
  adjClose?: number;
}

export type Market = "A" | "US" | "HK";

/** Basis of OHLC/close, separate from optional adjClose; not a total-return guarantee. */
export type PriceAdjustment = "provider-unspecified" | "forward-adjusted" | "unadjusted" | "unit-nav" | "index-level";

export interface SymbolInfo {
  code: string;
  name: string;
  market: Market;
  exchange?: string;
  type?: "stock" | "etf" | "index" | "fund";
  listDate?: string;
}

export interface SymbolMeta {
  symbol: string;
  name: string;
  market: string;
  source: string;
  firstDate: string;
  lastDate: string;
  rowCount: number;
  fetchedAt: string;
  /** Last successful provider request, used to check cache window coverage. */
  fetchedRange?: { start: string | null; end: string | null };
  /** Exact normalized rows in that response, distinct from accumulated history. Absent on older snapshots. */
  fetchedDates?: string[];
  /** Present only when this response preserves missing turnover as null. */
  turnoverSemantics?: "nullable";
  /** Successful endpoint of the latest response only; merged older rows may come from other endpoints. */
  lastResponseEndpoint?: string;
  /** Basis of the latest response. Absent on older snapshots whose basis was not recorded. */
  lastResponseAdjustment?: PriceAdjustment;
  /** New writes use this protocol; all non-head revisions need a commit marker for historical use. */
  archiveCommitProtocol?: "head-or-marker-v1";
}

/** Exact public daily observations used by a computation; never a private account snapshot. */
export interface DatasetRef {
  version: 1;
  kind: "daily-bars";
  symbol: string;
  market: Market;
  source: string;
  revision: string;
  contentHash: string;
  dates: string[];
  requested: { start: string | null; end: string | null };
  snapshotAt: string;
  adjustment: PriceAdjustment;
  availability: "observed-at-fetch";
  /** Concrete provider endpoint that returned these pinned observations, when known. */
  providerEndpoint?: string;
}

export interface BarsSnapshot {
  version: 1;
  revision: string;
  bars: Bar[];
  meta: SymbolMeta;
}

export interface CachedBars {
  bars: Bar[];
  fresh: boolean;
  dataset?: DatasetRef;
  turnoverSemantics?: "nullable" | "legacy-unknown";
}

export interface FundHolding {
  code: string;
  name: string;
  type?: string;
  manager?: string;
  company?: string;
  addedDate?: string;
  note?: string;
  lockedUntil?: string | null;
}

export interface HoldingsFile {
  updated: string;
  funds: FundHolding[];
  focusSectors?: string[];
  hash?: string;
  hashOf?: string;
}

export interface DailyNav {
  date: string;
  nav: number;
  chgPct: number;
  navDate: string;
}

export interface FundNavDaily {
  fundCode: string;
  navDate: string;
  unitNav: number;
  accumulatedNav: number | null;
  dailyReturnPct: number | null;
  isOpenDay: boolean;
  source: string;
}

export interface DailyFile {
  funds: Record<string, DailyNav[]>;
  dates: string[];
  lastUpdated: string;
}
