import { loadWatchlist } from "./storage/index.ts";

export interface CodeEntry { code: string; name: string }

export function loadWatchlistEntries(): CodeEntry[] {
  return loadWatchlist().funds.map((entry) => ({ code: entry.code, name: entry.name }));
}