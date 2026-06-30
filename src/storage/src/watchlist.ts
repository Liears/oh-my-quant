import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureDirs, resolveWatchlistPath } from "./dirs.ts";
import { emitFileEvent } from "./fs-events.ts";

export interface WatchlistEntry {
  code: string;
  name: string;
  added: string;
}

export interface Watchlist {
  funds: WatchlistEntry[];
}

export function loadWatchlist(): Watchlist {
  const path = resolveWatchlistPath();
  if (!existsSync(path)) return { funds: [] };
  try {
    const text = readFileSync(path, "utf-8");
    emitFileEvent({ operation: "READ", path, bytes: text.length, detail: "watchlist" });
    const raw = JSON.parse(text);
    // migrate old "stocks" format
    if (!raw.funds && raw.stocks) {
      return { funds: raw.stocks.map((s: any) => ({ code: s.code, name: s.name, added: s.added })) };
    }
    return { funds: raw.funds ?? [] };
  } catch {
    return { funds: [] };
  }
}

export function saveWatchlist(wl: Watchlist): void {
  ensureDirs();
  const path = resolveWatchlistPath();
  const text = JSON.stringify(wl, null, 2);
  writeFileSync(path, text, "utf-8");
  emitFileEvent({ operation: "WRITE", path, bytes: text.length, detail: "watchlist" });
}