import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { emitFileEvent } from "./fs-events.ts";
import { resolveInsightCachePath } from "./dirs.ts";

export function insightCacheMtimeMs(): number {
  try { return statSync(resolveInsightCachePath()).mtimeMs; } catch { return 0; }
}

export function loadInsightCache(): unknown[] {
  const path = resolveInsightCachePath();
  if (!existsSync(path)) return [];
  try {
    const text = readFileSync(path, "utf-8");
    emitFileEvent({ operation: "READ", path, bytes: text.length, detail: "insight cache" });
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveInsightCache(entries: unknown[]): void {
  const path = resolveInsightCachePath();
  mkdirSync(dirname(path), { recursive: true });
  const text = JSON.stringify(entries, null, 2);
  writeFileSync(path, text, "utf-8");
  emitFileEvent({ operation: "WRITE", path, bytes: text.length, detail: "insight cache" });
}