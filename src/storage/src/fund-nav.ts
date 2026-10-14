import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { normalizeFundNav, normalizeFundSymbol, publicFundFee, publicFundNavRef, isObservationTime } from "../../market/fund-nav.ts";
import { FUND_NAV_ENDPOINTS } from "../../types/fund-data.ts";
import type { FundFeeObservation, FundNavDatasetRef, FundNavEndpoint, FundNavSnapshot } from "../../types/fund-data.ts";
import type { FundNavDaily } from "../../types/data.ts";
import { resolveDataDir } from "./dirs.ts";
import { atomicWriteJson, withFileLockAsync } from "./atomic-file.ts";
import { emitFileEvent } from "./fs-events.ts";

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function commitMarker(snapshot: FundNavSnapshot) {
  return { version: 1 as const, revision: snapshot.revision, snapshotHash: hash(snapshot) };
}
function markerPath(path: string): string { return path.replace(/\.json$/u, ".commit"); }
function markerStatus(path: string, snapshot: FundNavSnapshot): "missing" | "valid" | "damaged" {
  const marker = markerPath(path);
  if (!existsSync(marker)) return "missing";
  try {
    const text = readFileSync(marker, "utf8");
    emitFileEvent({ operation: "READ", path: marker, bytes: Buffer.byteLength(text), detail: "fund NAV commit marker" });
    const value = JSON.parse(text) as Record<string, unknown>, expected = commitMarker(snapshot);
    return Object.keys(value).length === 3 && value.version === expected.version && value.revision === expected.revision
      && value.snapshotHash === expected.snapshotHash ? "valid" : "damaged";
  } catch { return "damaged"; }
}

/** Immutable research evidence only. No head or freshness cache; live queries stay live. */
export async function archiveFundNav(symbol: string, navRows: FundNavDaily[], endpoint: FundNavEndpoint, fetchedAt: string, fee: FundFeeObservation | null = null, signal?: AbortSignal): Promise<FundNavDatasetRef | null> {
  signal?.throwIfAborted();
  const canonical = normalizeFundSymbol(symbol), nav = normalizeFundNav(canonical, navRows);
  if (!FUND_NAV_ENDPOINTS.includes(endpoint) || !isObservationTime(fetchedAt)) throw new Error("Invalid NAV observation metadata.");
  const publicFee = publicFundFee(fee);
  if (!nav.length) return null;
  const payload = { version: 1 as const, symbol: canonical, source: "akshare" as const, endpoint, fetchedAt, nav, fee: publicFee };
  const snapshot: FundNavSnapshot = { ...payload, revision: hash(payload) };
  const ref: FundNavDatasetRef = { version: 1, kind: "fund-nav", symbol: canonical, market: "A", source: "akshare", endpoint,
    revision: snapshot.revision, contentHash: hash(nav), dates: nav.map(row => row.navDate), requested: { start: null, end: null },
    snapshotAt: fetchedAt, adjustment: "unit-nav-unadjusted", availability: "observed-at-fetch" };
  const directory = join(resolveDataDir(), "akshare", canonical, "nav-revisions");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${snapshot.revision}.json`);
  return withFileLockAsync(path, () => {
    if (existsSync(path)) { loadFundNavDataset(ref); return ref; }
    try {
      signal?.throwIfAborted();
      const bytes = atomicWriteJson(path, snapshot);
      emitFileEvent({ operation: "WRITE", path, bytes, detail: "immutable public NAV revision" });
      signal?.throwIfAborted();
      const marker = markerPath(path), markerBytes = atomicWriteJson(marker, commitMarker(snapshot));
      emitFileEvent({ operation: "WRITE", path: marker, bytes: markerBytes, detail: "fund NAV commit marker" });
      return ref;
    } catch (error) {
      // A file left before the marker is not an acknowledged observation.
      if (existsSync(path) && markerStatus(path, snapshot) === "missing") {
        try {
          unlinkSync(path);
          emitFileEvent({ operation: "DELETE", path, detail: "uncommitted fund NAV revision" });
        } catch (cleanupError) {
          if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT")
            throw new Error("Uncommitted fund NAV revision could not be removed; inspect the data archive.");
        }
      }
      throw error;
    }
  }, signal);
}

export function loadFundNavDataset(value: FundNavDatasetRef): FundNavSnapshot {
  const ref = publicFundNavRef(value);
  const path = join(resolveDataDir(), "akshare", ref.symbol, "nav-revisions", `${ref.revision}.json`);
  let raw: FundNavSnapshot;
  try {
    const text = readFileSync(path, "utf8");
    raw = JSON.parse(text) as FundNavSnapshot;
    emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(text), detail: "public NAV revision" });
  } catch { throw new Error(`Fund NAV revision unavailable: ${ref.revision}`); }
  const nav = normalizeFundNav(ref.symbol, raw.nav), fee = publicFundFee(raw.fee);
  const payload = { version: 1, symbol: ref.symbol, source: "akshare", endpoint: ref.endpoint, fetchedAt: ref.snapshotAt, nav, fee };
  if (raw.version !== 1 || raw.symbol !== ref.symbol || raw.source !== ref.source || raw.endpoint !== ref.endpoint || raw.fetchedAt !== ref.snapshotAt
    || raw.revision !== ref.revision || hash(payload) !== ref.revision || JSON.stringify(raw.nav) !== JSON.stringify(nav)
    || nav.length !== ref.dates.length || nav.some((row, i) => row.navDate !== ref.dates[i]) || hash(nav) !== ref.contentHash) throw new Error("Fund NAV reference does not match its archived observations.");
  const marker = markerStatus(path, raw);
  if (marker !== "valid") throw new Error(`Fund NAV revision unavailable: ${marker === "missing" ? "uncommitted" : "damaged commit marker"} ${ref.revision}`);
  return { ...payload, version: 1, source: "akshare", revision: ref.revision };
}
