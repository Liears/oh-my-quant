import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitFileEvent } from "./fs-events.ts";
import { ensureDirs, resolveBenchmarkResultsDir } from "./dirs.ts";

export interface SavedBenchmarkResult {
  filename: string;
  path: string;
}

export function saveBenchmarkResult(filename: string, value: Record<string, unknown>): SavedBenchmarkResult {
  ensureDirs();
  const dir = resolveBenchmarkResultsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    emitFileEvent({ operation: "MKDIR", path: dir, detail: "benchmark results" });
  }
  const path = join(dir, filename);
  const text = JSON.stringify(value, null, 2);
  writeFileSync(path, text, "utf-8");
  emitFileEvent({ operation: "WRITE", path, bytes: text.length, detail: "benchmark result" });
  return { filename, path };
}

export function listBenchmarkResults(): Record<string, unknown>[] {
  const dir = resolveBenchmarkResultsDir();
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".json"));
    emitFileEvent({ operation: "READ", path: dir, detail: "benchmark index" });
  } catch {
    return [];
  }
  return files
    .map((file) => {
      const path = join(dir, file);
      try {
        const text = readFileSync(path, "utf-8");
        emitFileEvent({ operation: "READ", path, bytes: text.length, detail: "benchmark result" });
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((value): value is Record<string, unknown> => value !== null);
}