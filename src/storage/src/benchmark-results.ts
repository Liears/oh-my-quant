import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { emitFileEvent } from "./fs-events.ts";
import { ensureDirs, resolveBenchmarkResultsDir } from "./dirs.ts";
import { atomicWriteJson } from "./atomic-file.ts";
import { createHash } from "node:crypto";
import type { BenchmarkResultSnapshot } from "../../types/benchmark-data.ts";
import { setImmediate } from "node:timers/promises";

export interface SavedBenchmarkResult {
  filename: string;
  path: string;
}

export function saveBenchmarkResult(filename: string, value: Record<string, unknown>): SavedBenchmarkResult {
  if (!/^[\p{L}\p{N}_.-]+\.json$/u.test(filename)) throw new Error("Invalid benchmark result filename.");
  ensureDirs();
  const dir = resolveBenchmarkResultsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    emitFileEvent({ operation: "MKDIR", path: dir, detail: "benchmark results" });
  }
  const path = join(dir, filename);
  const bytes = atomicWriteJson(path, value);
  emitFileEvent({ operation: "WRITE", path, bytes, detail: "benchmark result" });
  return { filename, path };
}

export function listBenchmarkResults(): Record<string, unknown>[] {
  return [...readBenchmarkResults()].flatMap(snapshot => snapshot ? [snapshot.result] : []);
}

export async function listBenchmarkResultSnapshots(signal?: AbortSignal): Promise<{ snapshots: BenchmarkResultSnapshot[]; unavailableFiles: number }> {
  const snapshots: BenchmarkResultSnapshot[] = [];
  let unavailableFiles = 0, visited = 0;
  for (const snapshot of readBenchmarkResults(signal)) {
    if (snapshot) snapshots.push(snapshot); else unavailableFiles++;
    // Let input/cancellation run during large local scans without yielding inside a write lock.
    if (++visited % 32 === 0) await setImmediate();
  }
  signal?.throwIfAborted();
  return { snapshots, unavailableFiles };
}

function* readBenchmarkResults(signal?: AbortSignal): Generator<BenchmarkResultSnapshot | null> {
  signal?.throwIfAborted();
  const dir = resolveBenchmarkResultsDir();
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".json")).sort();
    emitFileEvent({ operation: "READ", path: dir, detail: "benchmark index" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const file of files) {
    signal?.throwIfAborted();
    const path = join(dir, file);
    try {
      const text = readFileSync(path, "utf-8");
      emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(text), detail: "benchmark result" });
      const result: unknown = JSON.parse(text);
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Expected a benchmark object");
      yield { filename: file, revision: createHash("sha256").update(JSON.stringify(result)).digest("hex"), result: result as Record<string, unknown> };
    } catch { yield null; }
  }
  signal?.throwIfAborted();
}
