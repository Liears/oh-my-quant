import { SOURCE_LABELS } from "../source/index.ts";
import type { LiveBarsFetchResult, PullSource } from "../source/index.ts";
import { fetchLiveBars } from "./source-runtime.ts";
import { inferMarket, normalizeSymbol } from "../market/symbols.ts";
import type { MarketSymbol } from "../market/symbols.ts";
import type { QuoteObservation } from "../types/market-observation.ts";
import type { OverviewBudget } from "./overview-budget.ts";

export type OverviewSymbolEntry = MarketSymbol & { name: string; instrument?: "fund" | "security" };
export type OverviewQuote = { code: string; name: string; price: number; pct: number; observation?: QuoteObservation };
export type OverviewHolding = OverviewQuote;
export interface OverviewPullMeta {
  signal?: AbortSignal;
  sources: PullSource[];
  asOfDates: string[];
  pool?: OverviewRequestPool;
  /** Settled rows in input order positions; only the owning refresh may publish them. */
  onRow?: (row: OverviewQuote, index: number) => void;
}
export type OverviewQuoteFetcher = (entries: OverviewSymbolEntry[], meta: OverviewPullMeta) => Promise<OverviewQuote[]>;
export type OverviewHoldingFetcher = OverviewQuoteFetcher;

export interface OverviewRequestTiming {
  symbol: string;
  queueMs: number;
  fetchMs: number | null;
  outcome: "success" | "empty" | "error" | "cancelled";
}
interface RequestJob {
  symbol: string;
  submittedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  outcome: OverviewRequestTiming["outcome"] | null;
  resolve: (result: LiveBarsFetchResult) => void;
  reject: (error: unknown) => void;
}

/** One generation only: bounds active calls and shares duplicates across market/portfolio rows. */
export class OverviewRequestPool {
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private readonly fetcher: typeof fetchLiveBars;
  private readonly concurrency: number;
  private readonly budget: OverviewBudget | undefined;
  private readonly end: string;
  private readonly start: string;
  private active = 0;
  private readonly queued: RequestJob[] = [];
  private readonly jobs: RequestJob[] = [];
  private readonly requests = new Map<string, Promise<LiveBarsFetchResult>>();

  constructor(options: { signal?: AbortSignal; budget?: OverviewBudget; fetcher?: typeof fetchLiveBars; concurrency?: number; now?: Date } = {}) {
    this.concurrency = options.concurrency ?? 8;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new Error("Overview concurrency must be a positive integer");
    this.fetcher = options.fetcher ?? fetchLiveBars;
    this.budget = options.budget;
    this.signal = AbortSignal.any([this.controller.signal, ...(options.signal ? [options.signal] : []), ...(options.budget ? [options.budget.signal] : [])]);
    const now = options.now ?? new Date();
    this.end = now.toISOString().slice(0, 10);
    this.start = new Date(now.getTime() - 45 * 86400_000).toISOString().slice(0, 10);
    this.signal.addEventListener("abort", this.cancel, { once: true });
  }

  async fetch(entry: OverviewSymbolEntry): Promise<LiveBarsFetchResult> {
    this.budget?.check();
    this.signal.throwIfAborted();
    const symbol = normalizeSymbol(overviewProviderSymbol(entry));
    let promise = this.requests.get(symbol);
    if (!promise) {
      promise = new Promise<LiveBarsFetchResult>((resolve, reject) => {
        const job: RequestJob = { symbol, submittedAt: performance.now(), startedAt: null, endedAt: null, outcome: null, resolve, reject };
        this.queued.push(job); this.jobs.push(job);
      });
      this.requests.set(symbol, promise);
      this.drain();
    }
    return promise;
  }

  timings(): OverviewRequestTiming[] {
    return this.jobs.filter(job => job.endedAt !== null).map(job => ({ symbol: job.symbol,
      queueMs: (job.startedAt ?? job.endedAt!) - job.submittedAt,
      fetchMs: job.startedAt === null ? null : job.endedAt! - job.startedAt,
      outcome: job.outcome!,
    }));
  }

  close(): void {
    this.controller.abort(new Error("Overview request pool closed"));
    this.signal.removeEventListener("abort", this.cancel);
  }

  private readonly cancel = (): void => {
    for (const job of this.jobs) {
      if (job.endedAt !== null) continue;
      job.endedAt = performance.now(); job.outcome = "cancelled";
      job.reject(this.signal.reason);
    }
    this.queued.length = 0;
  };

  private drain(): void {
    while (!this.signal.aborted && this.active < this.concurrency && this.queued.length) {
      try { this.budget?.check(); } catch { return; } // Expiry cancels the queue through the shared signal.
      const job = this.queued.shift()!;
      this.active++;
      void this.run(job);
    }
  }

  private async run(job: RequestJob): Promise<void> {
    job.startedAt = performance.now();
    try {
      const result = await this.fetcher(job.symbol, inferMarket(job.symbol), this.start, this.end, { providers: { signal: this.signal } });
      this.budget?.check();
      this.signal.throwIfAborted();
      job.endedAt = performance.now(); job.outcome = result.bars.length ? "success" : result.attempts.some(attempt => attempt.status === "error") ? "error" : "empty";
      job.resolve(result);
    } catch (error) {
      if (job.endedAt === null) {
        job.endedAt = performance.now(); job.outcome = this.signal.aborted ? "cancelled" : "error";
        job.reject(error);
      }
    } finally { this.active--; this.drain(); }
  }
}

export async function fetchOverviewQuotes(entries: OverviewSymbolEntry[], meta: OverviewPullMeta): Promise<OverviewQuote[]> {
  return fetchOverviewHoldings(entries, meta);
}

export async function fetchOverviewHoldings(entries: OverviewSymbolEntry[], meta: OverviewPullMeta): Promise<OverviewHolding[]> {
  const pool = meta.pool ?? new OverviewRequestPool({ signal: meta.signal });
  try {
    return await Promise.all(entries.map(async (entry, index) => {
      let price = Number.NaN, pct = Number.NaN;
      let observation: QuoteObservation = { symbol: overviewProviderSymbol(entry), source: "unavailable", sourceLabel: "暂无数据",
        asOfDate: null, fetchedAt: new Date().toISOString(), state: "unavailable", fallback: false };
      try {
        const result = await pool.fetch(entry);
        meta.signal?.throwIfAborted();
        meta.sources.push(result.source);
        if (result.asOfDate) meta.asOfDates.push(result.asOfDate);
        const last = result.bars.at(-1), previous = result.bars.at(-2);
        observation = { symbol: normalizeSymbol(overviewProviderSymbol(entry)), source: result.source, sourceLabel: SOURCE_LABELS[result.source],
          asOfDate: result.asOfDate || null, fetchedAt: new Date().toISOString(),
          state: result.bars.length < 2 ? "unavailable" : result.window === "latest-available" ? "outside-window" : "available",
          fallback: result.attempts.some(attempt => attempt.status !== "success"),
        };
        if (last && previous) { price = last.close; pct = (last.close / previous.close - 1) * 100; }
      } catch (error) {
        meta.signal?.throwIfAborted();
        observation.fetchedAt = new Date().toISOString();
      }
      meta.signal?.throwIfAborted();
      const row = { code: entry.code, name: entry.name || entry.code, price, pct, observation };
      meta.onRow?.(structuredClone(row), index);
      return row;
    }));
  } finally { if (!meta.pool) pool.close(); }
}

/** Preserve open-fund identity while keeping exchange-traded funds on exchange routes. */
export function overviewProviderSymbol(entry: OverviewSymbolEntry): string {
  const symbol = entry.code.trim();
  if (entry.instrument !== "fund" || !/^\d{6}$/u.test(symbol)) return symbol;
  if (/^(?:5\d{5}|159\d{3})$/u.test(symbol)) return symbol;
  return `${symbol}.OF`;
}
