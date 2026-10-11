import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AnnualReportArtifact } from "../../types/annual-report.ts";
import { resolveAnnualReportsDir } from "./dirs.ts";
import { atomicWriteJson, atomicWriteText, withFileLock } from "./atomic-file.ts";
import { emitFileEvent } from "./fs-events.ts";

function annualPath(id: string, extension: "json" | "html"): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error("Invalid annual report ID.");
  return join(resolveAnnualReportsDir(), `${id}.${extension}`);
}

export function saveAnnualReport(input: Omit<AnnualReportArtifact, "id" | "version" | "kind">): AnnualReportArtifact {
  const artifact: AnnualReportArtifact = { version: 1, kind: "annual-research-report", id: randomUUID(), ...input };
  const path = annualPath(artifact.id, "json"), dir = resolveAnnualReportsDir();
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); emitFileEvent({ operation: "MKDIR", path: dir, detail: "annual research" }); }
  withFileLock(path, () => {
    if (existsSync(path)) throw new Error("Annual report already exists.");
    const bytes = atomicWriteJson(path, { artifact, hash: createHash("sha256").update(JSON.stringify(artifact)).digest("hex") });
    emitFileEvent({ operation: "WRITE", path, bytes, detail: "immutable annual research" });
  });
  return artifact;
}

export function loadAnnualReport(id: string): AnnualReportArtifact {
  const path = annualPath(id, "json"), text = readFileSync(path, "utf8");
  emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(text), detail: "annual research" });
  const envelope = JSON.parse(text) as { artifact?: AnnualReportArtifact; hash?: string } | null;
  const artifact = envelope?.artifact;
  if (!artifact || artifact.id !== id || artifact.version !== 1 || artifact.kind !== "annual-research-report"
    || artifact.perspectiveVersion !== 1 || !artifact.request || typeof artifact.html !== "string" || !artifact.html.startsWith("<!DOCTYPE html>")
    || typeof artifact.createdAt !== "string" || !Number.isFinite(Date.parse(artifact.createdAt))
    || typeof artifact.comparisonHash !== "string" || !/^[a-f0-9]{64}$/.test(artifact.comparisonHash)
    || createHash("sha256").update(JSON.stringify(artifact)).digest("hex") !== envelope?.hash) throw new Error("Annual report integrity check failed; original file preserved.");
  return artifact;
}

/** Call only after checking the bound comparison and its public observation archives. */
export function materializeAnnualReport(artifact: AnnualReportArtifact): string {
  const path = annualPath(artifact.id, "html");
  withFileLock(path, () => {
    const bytes = atomicWriteText(path, artifact.html);
    emitFileEvent({ operation: "WRITE", path, bytes, detail: "annual research preview" });
  });
  return path;
}

/** File names only; runtime verifies both each envelope and its referenced evidence. */
export function listAnnualReportFiles(): string[] {
  const dir = resolveAnnualReportsDir();
  return existsSync(dir) ? readdirSync(dir).filter(file => file.endsWith(".json")).sort() : [];
}
