/** Public daily-bar snapshots. User holdings never belong here. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { resolveDataDir } from "./dirs.ts";
import { emitFileEvent } from "./fs-events.ts";
import { atomicWriteJsonAsync, withFileLockAsync } from "./atomic-file.ts";
import { normalizeBarSeries, validateDateRange } from "../../market/bars.ts";
import { inferMarket, normalizeSymbol } from "../../market/symbols.ts";
import { isSafeProviderEndpoint } from "../../market/provider-endpoint.ts";
import { validateObservationCutoff } from "../../market/observation-cutoff.ts";
import { isPriceAdjustment } from "../../market/price-adjustment.ts";
import type { Bar, BarsSnapshot, CachedBars, DatasetRef, PriceAdjustment, SymbolMeta } from "../../types/data.ts";

const CACHE_MAX_AGE_MS = 5 * 60_000;
const SOURCES = ["akshare", "tushare", "llmquant-data", "financial-datasets"];
const COMMIT_PROTOCOL = "head-or-marker-v1" as const;

function symbolDir(symbol: string, source: string): string {
  if (!SOURCES.includes(source)) throw new Error(`Invalid data source: ${source}`);
  return join(resolveDataDir(), source, normalizeSymbol(symbol));
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseBarsSnapshot(text: string, symbol: string, source: string, revision?: string): BarsSnapshot | null {
  const raw = JSON.parse(text) as BarsSnapshot;
  const bars = normalizeBarSeries(raw.bars);
  const meta = raw.meta;
  if (raw.version !== 1 || !bars.length || !meta
    || JSON.stringify(bars) !== JSON.stringify(raw.bars)
    || meta.symbol !== normalizeSymbol(symbol) || meta.source !== source || meta.market !== inferMarket(symbol)
    || meta.rowCount !== bars.length || meta.firstDate !== bars[0]!.date || meta.lastDate !== bars.at(-1)!.date
    || !Number.isFinite(Date.parse(meta.fetchedAt))
    || (meta.turnoverSemantics !== undefined && meta.turnoverSemantics !== "nullable")
    || (meta.archiveCommitProtocol !== undefined && meta.archiveCommitProtocol !== COMMIT_PROTOCOL)
    || (meta.lastResponseAdjustment !== undefined && (!isPriceAdjustment(meta.lastResponseAdjustment) || meta.fetchedDates === undefined))
    || (meta.lastResponseEndpoint !== undefined && (!isSafeProviderEndpoint(meta.lastResponseEndpoint) || meta.fetchedDates === undefined))
    || raw.revision !== hash({ version: 1, bars, meta })
    || (revision !== undefined && raw.revision !== revision)) return null;
  if (meta.fetchedDates !== undefined) {
    const range = meta.fetchedRange;
    if (!Array.isArray(meta.fetchedDates) || !meta.fetchedDates.length || !range
      || (range.start !== null && typeof range.start !== "string") || (range.end !== null && typeof range.end !== "string")) return null;
    validateDateRange(range.start ?? undefined, range.end ?? undefined);
    const dates = new Set(bars.map(bar => bar.date));
    if (meta.fetchedDates.some((date, index) => typeof date !== "string" || !dates.has(date)
      || (index > 0 && date <= meta.fetchedDates![index - 1]!)
      || (range.start !== null && date < range.start) || (range.end !== null && date > range.end))) return null;
  }
  return raw;
}

/** One read supplies both data and metadata; a corrupt head never falls back to legacy files. */
export function readBarsSnapshot(symbol: string, source: string, revision?: string): BarsSnapshot | null {
  if (revision !== undefined && !/^[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid dataset revision.");
  const dir = symbolDir(symbol, source);
  const path = revision ? join(dir, "revisions", `${revision}.json`) : join(dir, "snapshot.json");
  try {
    const text = readFileSync(path, "utf8");
    emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(text), detail: "bars snapshot" });
    return parseBarsSnapshot(text, symbol, source, revision);
  } catch { return null; }
}

async function readBarsSnapshotAsync(symbol: string, source: string, revision?: string, signal?: AbortSignal): Promise<BarsSnapshot | null> {
  if (revision !== undefined && !/^[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid dataset revision.");
  signal?.throwIfAborted();
  const dir = symbolDir(symbol, source);
  const path = revision ? join(dir, "revisions", `${revision}.json`) : join(dir, "snapshot.json");
  try {
    const text = await readFile(path, { encoding: "utf8", signal });
    emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(text), detail: "bars snapshot" });
    return parseBarsSnapshot(text, symbol, source, revision);
  } catch (error) {
    signal?.throwIfAborted();
    return null;
  }
}

function commitMarkerPath(symbol: string, source: string, revision: string): string {
  return join(symbolDir(symbol, source), "revisions", `${revision}.commit`);
}

function commitMarker(snapshot: BarsSnapshot) {
  return { version: 1 as const, revision: snapshot.revision, snapshotHash: hash(snapshot) };
}

function markerStatus(snapshot: BarsSnapshot): "missing" | "valid" | "damaged" {
  const markerPath = commitMarkerPath(snapshot.meta.symbol, snapshot.meta.source, snapshot.revision);
  if (!existsSync(markerPath)) return "missing";
  try {
    const text = readFileSync(markerPath, "utf8");
    emitFileEvent({ operation: "READ", path: markerPath, bytes: Buffer.byteLength(text), detail: "bars commit marker" });
    const marker = JSON.parse(text) as Record<string, unknown>;
    const expected = commitMarker(snapshot);
    return Object.keys(marker).length === 3 && marker.version === expected.version && marker.revision === expected.revision
      && marker.snapshotHash === expected.snapshotHash ? "valid" : "damaged";
  } catch { return "damaged"; }
}

async function markerStatusAsync(snapshot: BarsSnapshot, signal?: AbortSignal): Promise<"missing" | "valid" | "damaged"> {
  signal?.throwIfAborted();
  const markerPath = commitMarkerPath(snapshot.meta.symbol, snapshot.meta.source, snapshot.revision);
  try {
    const text = await readFile(markerPath, { encoding: "utf8", signal });
    emitFileEvent({ operation: "READ", path: markerPath, bytes: Buffer.byteLength(text), detail: "bars commit marker" });
    const marker = JSON.parse(text) as Record<string, unknown>;
    const expected = commitMarker(snapshot);
    return Object.keys(marker).length === 3 && marker.version === expected.version && marker.revision === expected.revision
      && marker.snapshotHash === expected.snapshotHash ? "valid" : "damaged";
  } catch (error) {
    signal?.throwIfAborted();
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "damaged";
  }
}

function revisionCommitted(snapshot: BarsSnapshot, headRevision: string | undefined): boolean {
  if (snapshot.revision === headRevision) return true;
  const status = markerStatus(snapshot);
  if (status === "damaged") throw new Error("Historical dataset archive unavailable: damaged commit marker.");
  return status === "valid";
}

async function revisionCommittedAsync(snapshot: BarsSnapshot, headRevision: string | undefined, signal?: AbortSignal): Promise<boolean> {
  if (snapshot.revision === headRevision) return true;
  const status = await markerStatusAsync(snapshot, signal);
  if (status === "damaged") throw new Error("Historical dataset archive unavailable: damaged commit marker.");
  return status === "valid";
}

async function certifyPreviousHeadAsync(snapshot: BarsSnapshot, revisions: string, signal?: AbortSignal): Promise<void> {
  const markerPath = commitMarkerPath(snapshot.meta.symbol, snapshot.meta.source, snapshot.revision);
  const marker = await markerStatusAsync(snapshot, signal);
  if (marker === "damaged") throw new Error("Previous bars commit marker is damaged.");
  if (snapshot.meta.archiveCommitProtocol !== COMMIT_PROTOCOL) {
    const archive = join(revisions, `${snapshot.revision}.json`);
    const existing = await readBarsSnapshotAsync(snapshot.meta.symbol, snapshot.meta.source, snapshot.revision, signal);
    if (existing === null) {
      let missing = false;
      try { await readFile(archive, { signal }); } catch (error) {
        signal?.throwIfAborted();
        if ((error as NodeJS.ErrnoException).code === "ENOENT") missing = true;
        else throw new Error("Previous legacy bars revision is damaged; head was not changed.");
      }
      if (!missing) throw new Error("Previous legacy bars revision is damaged; head was not changed.");
      const bytes = await atomicWriteJsonAsync(archive, snapshot, signal);
      emitFileEvent({ operation: "WRITE", path: archive, bytes, detail: "certified legacy bars head" });
    }
  }
  if (marker === "missing") {
    signal?.throwIfAborted();
    const bytes = await atomicWriteJsonAsync(markerPath, commitMarker(snapshot), signal);
    emitFileEvent({ operation: "WRITE", path: markerPath, bytes, detail: "bars commit marker" });
  }
}

async function legacyBarsAsync(dir: string, signal?: AbortSignal): Promise<Bar[]> {
  signal?.throwIfAborted();
  try {
    await readFile(join(dir, "snapshot.json"), { signal });
    return [];
  } catch (error) {
    signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return [];
  }
  const path = join(dir, "daily.json");
  try {
    const text = await readFile(path, { encoding: "utf8", signal });
    emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(text), detail: "legacy bars (stale)" });
    return normalizeBarSeries(JSON.parse(text));
  } catch (error) {
    signal?.throwIfAborted();
    return [];
  }
}

function datasetRef(snapshot: BarsSnapshot, bars: Bar[], start?: string, end?: string): DatasetRef {
  return {
    version: 1, kind: "daily-bars", symbol: snapshot.meta.symbol, source: snapshot.meta.source,
    market: inferMarket(snapshot.meta.symbol), revision: snapshot.revision, contentHash: hash(bars),
    dates: bars.map(bar => bar.date), requested: { start: start ?? null, end: end ?? null },
    snapshotAt: snapshot.meta.fetchedAt, adjustment: snapshot.meta.lastResponseAdjustment ?? "provider-unspecified", availability: "observed-at-fetch",
    ...(snapshot.meta.fetchedDates && snapshot.meta.lastResponseEndpoint ? { providerEndpoint: snapshot.meta.lastResponseEndpoint } : {}),
  };
}

/** Reuse one response's actual observations. Accumulated history must not fill its missing rows. */
export async function loadCachedBars(symbol: string, source: string, start?: string, end?: string, signal?: AbortSignal): Promise<CachedBars> {
  signal?.throwIfAborted();
  validateDateRange(start, end);
  const snapshot = await readBarsSnapshotAsync(symbol, source, undefined, signal);
  const fetchedDates = snapshot?.meta.fetchedDates ? new Set(snapshot.meta.fetchedDates) : null;
  const observations = snapshot ? fetchedDates ? snapshot.bars.filter(bar => fetchedDates.has(bar.date)) : snapshot.bars
    : await legacyBarsAsync(symbolDir(symbol, source), signal);
  const bars = normalizeBarSeries(observations, start, end);
  if (!snapshot || !bars.length) return { bars, fresh: false };
  const age = Date.now() - Date.parse(snapshot.meta.fetchedAt);
  const range = snapshot.meta.fetchedRange;
  // An unbounded request does not prove the provider returned observations beyond this response.
  const responseFirst = snapshot.meta.fetchedDates?.[0], responseLast = snapshot.meta.fetchedDates?.at(-1);
  const coversStart = range && (range.start === null
    ? start === undefined || (responseFirst !== undefined && responseFirst <= start)
    : start !== undefined && range.start <= start);
  const coversEnd = range && (range.end === null
    ? end === undefined || (responseLast !== undefined && responseLast >= end)
    : end !== undefined && range.end >= end);
  return {
    bars, fresh: fetchedDates !== null && age >= 0 && age < CACHE_MAX_AGE_MS && Boolean(coversStart && coversEnd),
    dataset: datasetRef(snapshot, bars, start, end),
    turnoverSemantics: snapshot.meta.turnoverSemantics ?? "legacy-unknown",
  };
}

/** Archive-only observation query. One past provider response must cover the requested bounds. */
export async function loadArchivedBarsBefore(
  symbol: string, source: string, start: string | undefined, end: string | undefined, observedBefore: string, signal?: AbortSignal,
): Promise<CachedBars> {
  signal?.throwIfAborted();
  validateDateRange(start, end);
  const boundary = validateObservationCutoff(observedBefore);
  const revisions = join(symbolDir(symbol, source), "revisions");
  let files: string[];
  try { files = (await readdir(revisions)).filter(file => file.endsWith(".json")); }
  catch (error) {
    signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { bars: [], fresh: false };
    throw new Error("Historical dataset archive unavailable: revision directory cannot be read.");
  }
  if (files.length > 4096) throw new Error("Historical dataset archive unavailable: too many revisions to verify.");
  const headRevision = (await readBarsSnapshotAsync(symbol, source, undefined, signal))?.revision;
  let selected: { snapshot: BarsSnapshot; bars: Bar[] } | undefined;
  for (const file of files) {
    signal?.throwIfAborted();
    if (!/^[a-f0-9]{64}\.json$/.test(file)) throw new Error("Historical dataset archive unavailable: invalid revision name.");
    const snapshot = await readBarsSnapshotAsync(symbol, source, file.slice(0, -5), signal);
    if (!snapshot) throw new Error("Historical dataset archive unavailable: damaged revision preserved.");
    if (!await revisionCommittedAsync(snapshot, headRevision, signal)) continue;
    if (Date.parse(snapshot.meta.fetchedAt) > boundary || !snapshot.meta.fetchedDates || !snapshot.meta.fetchedRange) continue;
    const dates = new Set(snapshot.meta.fetchedDates);
    const rows = normalizeBarSeries(snapshot.bars.filter(row => dates.has(row.date)), start, end);
    const range = snapshot.meta.fetchedRange;
    const first = snapshot.meta.fetchedDates[0], last = snapshot.meta.fetchedDates.at(-1);
    const coversStart = range.start === null ? start === undefined || first !== undefined && first <= start
      : start !== undefined && range.start <= start;
    const coversEnd = range.end === null ? end === undefined || last !== undefined && last >= end
      : end !== undefined && range.end >= end;
    if (!rows.length || !coversStart || !coversEnd) continue;
    if (!selected || snapshot.meta.fetchedAt > selected.snapshot.meta.fetchedAt
      || snapshot.meta.fetchedAt === selected.snapshot.meta.fetchedAt && snapshot.revision > selected.snapshot.revision)
      selected = { snapshot, bars: rows };
  }
  return selected ? { bars: selected.bars, fresh: false,
    dataset: datasetRef(selected.snapshot, selected.bars, start, end),
    turnoverSemantics: selected.snapshot.meta.turnoverSemantics ?? "legacy-unknown" }
    : { bars: [], fresh: false };
}

export async function loadBars(symbol: string, source: string, signal?: AbortSignal): Promise<Bar[]> {
  // Explicit accumulated-history reader; no freshness or single-response guarantee.
  return (await readBarsSnapshotAsync(symbol, source, undefined, signal))?.bars ?? legacyBarsAsync(symbolDir(symbol, source), signal);
}

/** Serializes read/merge/commit across processes and archives the exact committed revision. */
export async function saveBars(
  symbol: string, source: string, bars: Bar[], start?: string, end?: string, signal?: AbortSignal, providerEndpoint?: string,
  adjustment: PriceAdjustment = "provider-unspecified",
): Promise<DatasetRef | null> {
  signal?.throwIfAborted();
  validateDateRange(start, end);
  if (providerEndpoint !== undefined && !isSafeProviderEndpoint(providerEndpoint)) throw new Error("Invalid provider endpoint.");
  if (!isPriceAdjustment(adjustment)) throw new Error("Invalid price adjustment.");
  const dir = symbolDir(symbol, source);
  const incoming = normalizeBarSeries(bars, start, end);
  if (!incoming.length) return null;
  const revisions = join(dir, "revisions");
  const created = await mkdir(revisions, { recursive: true });
  if (created !== undefined) emitFileEvent({ operation: "MKDIR", path: revisions, detail: "bars revisions" });
  const path = join(dir, "snapshot.json");
  return withFileLockAsync(path, async () => {
    const previous = await readBarsSnapshotAsync(symbol, source, undefined, signal);
    // qfq levels can be rebased even when the mode and endpoint stay the same.
    // Preserve old immutable revisions, but never splice their levels into a new response.
    const canMerge = adjustment !== "forward-adjusted"
      && adjustment === (previous?.meta.lastResponseAdjustment ?? "provider-unspecified");
    const history = canMerge ? previous?.bars ?? await legacyBarsAsync(dir, signal) : [];
    const merged = normalizeBarSeries([...history, ...incoming]);
    const meta: SymbolMeta = {
      symbol: normalizeSymbol(symbol), name: symbol, market: inferMarket(symbol), source,
      firstDate: merged[0]!.date, lastDate: merged.at(-1)!.date, rowCount: merged.length,
      fetchedAt: new Date().toISOString(), fetchedRange: { start: start ?? null, end: end ?? null }, fetchedDates: incoming.map(bar => bar.date),
      turnoverSemantics: "nullable",
      archiveCommitProtocol: COMMIT_PROTOCOL,
      lastResponseAdjustment: adjustment,
      ...(providerEndpoint ? { lastResponseEndpoint: providerEndpoint } : {}),
    };
    const payload = { version: 1 as const, bars: merged, meta };
    const snapshot: BarsSnapshot = { ...payload, revision: hash(payload) };
    const archive = join(revisions, `${snapshot.revision}.json`);
    let archiveWasPresent = true;
    try { await readFile(archive, { signal }); }
    catch (error) {
      signal?.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") archiveWasPresent = false;
      else throw error;
    }
    try {
      if (archiveWasPresent && !await readBarsSnapshotAsync(symbol, source, snapshot.revision, signal))
        throw new Error("Existing bars revision is damaged; head was not changed.");
      if (await markerStatusAsync(snapshot, signal) === "damaged")
        throw new Error("Existing bars commit marker is damaged; head was not changed.");
      // The previous valid head becomes historical only after durable certification.
      if (previous) await certifyPreviousHeadAsync(previous, revisions, signal);
      if (!archiveWasPresent) {
        signal?.throwIfAborted();
        const bytes = await atomicWriteJsonAsync(archive, snapshot, signal);
        emitFileEvent({ operation: "WRITE", path: archive, bytes, detail: "immutable bars revision" });
      }
      signal?.throwIfAborted();
      const bytes = await atomicWriteJsonAsync(path, snapshot, signal);
      emitFileEvent({ operation: "WRITE", path, bytes, detail: "bars snapshot" });
      // Once the head is committed, its revision must remain readable even if
      // the head is later damaged. A marker written before the head would
      // incorrectly certify a revision left behind by a crashed writer.
      const markerPath = commitMarkerPath(symbol, source, snapshot.revision);
      const marker = await markerStatusAsync(snapshot, signal);
      if (marker === "damaged") throw new Error("Bars commit marker is damaged.");
      if (marker === "missing") {
        const markerBytes = await atomicWriteJsonAsync(markerPath, commitMarker(snapshot), signal);
        emitFileEvent({ operation: "WRITE", path: markerPath, bytes: markerBytes, detail: "bars commit marker" });
      }
      return datasetRef(snapshot, incoming, start, end);
    } catch (error) {
      // A revision created by this failed commit is not an app observation.
      // Historical cutoff scans revisions independently of the current head.
      if (!archiveWasPresent && (await readBarsSnapshotAsync(symbol, source, undefined))?.revision !== snapshot.revision) {
        try {
          await unlink(archive);
          emitFileEvent({ operation: "DELETE", path: archive, detail: "uncommitted bars revision" });
        } catch (cleanupError) {
          if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT")
            throw new Error("Uncommitted bars revision could not be removed; inspect the data archive.");
        }
      }
      throw error;
    }
  }, signal);
}

/** Resolve exact observations; revisions that disappeared or were altered fail explicitly. */
export function loadDataset(ref: DatasetRef): Bar[] {
  if (ref.version !== 1 || ref.kind !== "daily-bars" || !Array.isArray(ref.dates) || !ref.dates.length
    || !ref.requested || (ref.requested.start !== null && typeof ref.requested.start !== "string")
    || (ref.requested.end !== null && typeof ref.requested.end !== "string")
    || !isPriceAdjustment(ref.adjustment) || ref.availability !== "observed-at-fetch"
    || (ref.providerEndpoint !== undefined && !isSafeProviderEndpoint(ref.providerEndpoint)))
    throw new Error("Invalid dataset reference.");
  validateDateRange(ref.requested.start ?? undefined, ref.requested.end ?? undefined);
  if (typeof ref.revision !== "string") throw new Error("Invalid dataset revision.");
  const snapshot = readBarsSnapshot(ref.symbol, ref.source, ref.revision);
  if (!snapshot) throw new Error(`Dataset revision unavailable: ${ref.revision}`);
  if (!revisionCommitted(snapshot, readBarsSnapshot(ref.symbol, ref.source)?.revision))
    throw new Error(`Dataset revision unavailable: uncommitted ${ref.revision}`);
  const wanted = new Set(ref.dates);
  const bars = snapshot.bars.filter(bar => wanted.has(bar.date));
  const responseDates = snapshot.meta.fetchedDates ? new Set(snapshot.meta.fetchedDates) : null;
  if (ref.market !== snapshot.meta.market || ref.snapshotAt !== snapshot.meta.fetchedAt
    || ref.adjustment !== (snapshot.meta.lastResponseAdjustment ?? "provider-unspecified")
    || ref.providerEndpoint !== snapshot.meta.lastResponseEndpoint
    || ((ref.providerEndpoint !== undefined || snapshot.meta.lastResponseAdjustment !== undefined)
      && (!responseDates || ref.dates.some(date => !responseDates.has(date))))
    || ref.dates.length !== bars.length || ref.dates.some((date, index) => date !== bars[index]!.date
      || (ref.requested.start !== null && date < ref.requested.start) || (ref.requested.end !== null && date > ref.requested.end))
    || hash(bars) !== ref.contentHash) throw new Error("Dataset reference does not match its observations.");
  return bars;
}

export async function isCacheFresh(symbol: string, source: string, start?: string, end?: string): Promise<boolean> {
  return (await loadCachedBars(symbol, source, start, end)).fresh;
}

export async function getMeta(symbol: string, source: string): Promise<SymbolMeta | null> {
  return (await readBarsSnapshotAsync(symbol, source))?.meta ?? null;
}

export function listCachedSymbols(source: string): string[] {
  if (!SOURCES.includes(source)) throw new Error(`Invalid data source: ${source}`);
  const dir = join(resolveDataDir(), source);
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  emitFileEvent({ operation: "READ", path: dir, detail: "cache index" });
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
}
