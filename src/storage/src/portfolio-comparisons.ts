import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { resolveBenchmarkComparisonsDir } from "./dirs.ts";
import { atomicWriteJson, withFileLock } from "./atomic-file.ts";
import { emitFileEvent } from "./fs-events.ts";
import type { PortfolioComparisonArtifact, PortfolioComparisonResult } from "../../types/portfolio-comparison.ts";

function comparisonPath(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error("Invalid portfolio comparison ID.");
  return join(resolveBenchmarkComparisonsDir(), "portfolios", `${id}.json`);
}

/** Immutable research artifact; contains hypothetical weights and public valuations, no account holdings. */
export function savePortfolioComparison(result: PortfolioComparisonResult): PortfolioComparisonArtifact {
  const artifact: PortfolioComparisonArtifact = { version: 1, kind: "portfolio-comparison", id: randomUUID(), createdAt: new Date().toISOString(), result };
  const serialized = JSON.stringify(artifact, (_key, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Cannot save nonfinite comparison values.");
    return value;
  });
  const dir = join(resolveBenchmarkComparisonsDir(), "portfolios"), path = comparisonPath(artifact.id);
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); emitFileEvent({ operation: "MKDIR", path: dir, detail: "portfolio research" }); }
  withFileLock(path, () => {
    if (existsSync(path)) throw new Error("Portfolio comparison already exists.");
    const bytes = atomicWriteJson(path, { artifact, hash: createHash("sha256").update(serialized).digest("hex") });
    emitFileEvent({ operation: "WRITE", path, bytes, detail: "immutable portfolio comparison" });
  });
  return artifact;
}

export function loadPortfolioComparison(id: string): PortfolioComparisonArtifact {
  const path = comparisonPath(id), text = readFileSync(path, "utf8");
  emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(text), detail: "portfolio comparison" });
  const envelope = JSON.parse(text) as { artifact?: PortfolioComparisonArtifact; hash?: string } | null;
  const artifact = envelope?.artifact;
  if (!artifact || artifact.id !== id || artifact.kind !== "portfolio-comparison" || artifact.version !== 1
    || typeof artifact.createdAt !== "string" || !Number.isFinite(Date.parse(artifact.createdAt))
    || ![1, 2].includes(artifact.result?.methodVersion) || !artifact.result.input
    || createHash("sha256").update(JSON.stringify(artifact)).digest("hex") !== envelope?.hash) throw new Error("Portfolio comparison integrity check failed.");
  return artifact;
}

export function listPortfolioComparisons(): { items: { id: string; createdAt: string; names: string[] }[]; unavailable: string[] } {
  const dir = join(resolveBenchmarkComparisonsDir(), "portfolios");
  if (!existsSync(dir)) return { items: [], unavailable: [] };
  const items: { id: string; createdAt: string; names: string[] }[] = [], unavailable: string[] = [];
  for (const file of readdirSync(dir).filter(name => name.endsWith(".json")).sort()) {
    try {
      const artifact = loadPortfolioComparison(file.slice(0, -5));
      items.push({ id: artifact.id, createdAt: artifact.createdAt, names: artifact.result.input.groups.map(group => group.name) });
    } catch { unavailable.push(file); }
  }
  return { items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), unavailable };
}
