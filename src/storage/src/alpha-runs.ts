import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AlphaBacktestResult, AlphaResearchRequest, AlphaRunArtifact } from "../../types/alpha.ts";
import { resolveAlphaRunsDir } from "./dirs.ts";
import { atomicWriteJson, withFileLockAsync } from "./atomic-file.ts";
import { emitFileEvent } from "./fs-events.ts";

function runPath(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error("Invalid alpha run ID.");
  return join(resolveAlphaRunsDir(), `${id}.json`);
}

/** Only verified hypothetical research belongs here; runtime owns semantic verification. */
export async function saveAlphaRun(request: AlphaResearchRequest, result: AlphaBacktestResult, origin: AlphaRunArtifact["origin"], signal?: AbortSignal): Promise<AlphaRunArtifact> {
  signal?.throwIfAborted();
  const artifact: AlphaRunArtifact = { version: 1, kind: "alpha-backtest", id: randomUUID(), createdAt: new Date().toISOString(),
    origin, request: structuredClone(request), result: structuredClone(result) };
  const serialized = JSON.stringify(artifact, (_key, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Cannot save nonfinite alpha values.");
    return value;
  });
  const dir = resolveAlphaRunsDir(), path = runPath(artifact.id);
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); emitFileEvent({ operation: "MKDIR", path: dir, detail: "alpha research" }); }
  await withFileLockAsync(path, () => {
    signal?.throwIfAborted();
    if (existsSync(path)) throw new Error("Alpha run already exists.");
    const bytes = atomicWriteJson(path, { artifact, hash: createHash("sha256").update(serialized).digest("hex") });
    emitFileEvent({ operation: "WRITE", path, bytes, detail: "immutable alpha run" });
  }, signal);
  return artifact;
}

export function loadAlphaRun(id: string): AlphaRunArtifact {
  const path = runPath(id), text = readFileSync(path, "utf8");
  emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(text), detail: "alpha research" });
  const envelope = JSON.parse(text) as { artifact?: AlphaRunArtifact; hash?: string } | null;
  const artifact = envelope?.artifact;
  if (!artifact || artifact.version !== 1 || artifact.kind !== "alpha-backtest" || artifact.id !== id
    || typeof artifact.createdAt !== "string" || !Number.isFinite(Date.parse(artifact.createdAt))
    || !["provider", "cache", "stale-cache"].includes(artifact.origin)
    || !artifact.request || artifact.result?.version !== 1 || !artifact.result.request?.dataset
    || createHash("sha256").update(JSON.stringify(artifact)).digest("hex") !== envelope?.hash)
    throw new Error("Alpha run integrity check failed.");
  return artifact;
}

export function listAlphaRuns(): { items: { id: string; symbol: string; createdAt: string }[]; unavailable: string[] } {
  const dir = resolveAlphaRunsDir();
  if (!existsSync(dir)) return { items: [], unavailable: [] };
  const items: { id: string; symbol: string; createdAt: string }[] = [], unavailable: string[] = [];
  for (const file of readdirSync(dir).filter(file => file.endsWith(".json")).sort()) {
    try {
      const artifact = loadAlphaRun(file.slice(0, -5));
      items.push({ id: artifact.id, symbol: artifact.request.symbol, createdAt: artifact.createdAt });
    } catch { unavailable.push(file); }
  }
  return { items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), unavailable };
}
