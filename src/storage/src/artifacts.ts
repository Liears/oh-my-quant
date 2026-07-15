/**
 * Artifact HTML file storage under .ohquant/artifacts/.
 * Each artifact is a self-contained HTML file derived from a session JSONL.
 * Artifacts are explicit outputs (artifact class) — they can be safely deleted
 * and regenerated from the source session.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitFileEvent } from "./fs-events.ts";
import { ensureDirs, resolveArtifactsDir } from "./dirs.ts";

export interface ArtifactMeta {
  /** Artifact file id (kept as sessionId for backward compatibility). */
  sessionId: string;
  /** Source JSONL session. May differ from the artifact file id. */
  sourceSessionId?: string;
  createdAt: string;
  refreshedAt?: string;
  title: string;
  messageCount: number;
  bytes: number;
}

export interface ArtifactPruneResult {
  artifacts: ArtifactMeta[];
  removedIds: string[];
}

function artifactsDir(): string {
  return resolveArtifactsDir();
}

function ensureArtifactsDir(): void {
  const dir = artifactsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    emitFileEvent({ operation: "MKDIR", path: dir, detail: "artifacts" });
  }
}

export function artifactPath(sessionId: string): string {
  return join(artifactsDir(), `${sessionId}.html`);
}

export function saveArtifact(
  sessionId: string,
  html: string,
  meta?: { title?: string; messageCount?: number; sourceSessionId?: string },
): void {
  ensureDirs();
  ensureArtifactsDir();
  const path = artifactPath(sessionId);

  // Update or create sidecar metadata
  const sidecarPath = join(artifactsDir(), `${sessionId}.meta.json`);
  const now = new Date().toISOString();
  const existingMeta = loadArtifactMetaFile(sidecarPath);
  const merged: ArtifactMeta = {
    sessionId,
    sourceSessionId: meta?.sourceSessionId ?? existingMeta?.sourceSessionId ?? sessionId,
    createdAt: existingMeta?.createdAt ?? now,
    refreshedAt: now,
    title: meta?.title ?? existingMeta?.title ?? sessionId,
    messageCount: meta?.messageCount ?? existingMeta?.messageCount ?? 0,
    bytes: Buffer.byteLength(html, "utf-8"),
  };
  const sidecarJson = JSON.stringify(merged, null, 2);
  writeFileSync(sidecarPath, sidecarJson, "utf-8");
  emitFileEvent({ operation: "WRITE", path: sidecarPath, bytes: Buffer.byteLength(sidecarJson, "utf-8"), detail: "artifact metadata" });

  writeFileSync(path, html, "utf-8");
  emitFileEvent({ operation: "WRITE", path, bytes: merged.bytes, detail: "artifact HTML" });
}

export function loadArtifact(sessionId: string): string | null {
  const path = artifactPath(sessionId);
  if (!existsSync(path)) return null;
  try {
    const html = readFileSync(path, "utf-8");
    emitFileEvent({ operation: "READ", path, bytes: html.length, detail: "artifact HTML" });
    return html;
  } catch {
    return null;
  }
}

export function loadArtifactMeta(sessionId: string): ArtifactMeta | null {
  const sidecarPath = join(artifactsDir(), `${sessionId}.meta.json`);
  return loadArtifactMetaFile(sidecarPath);
}

function loadArtifactMetaFile(path: string): ArtifactMeta | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as ArtifactMeta;
    if (!raw.sessionId || !raw.createdAt) return null;
    return raw;
  } catch {
    return null;
  }
}

export function listArtifacts(): ArtifactMeta[] {
  const dir = artifactsDir();
  if (!existsSync(dir)) return [];
  const metas: ArtifactMeta[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".meta.json")) continue;
    const meta = loadArtifactMetaFile(join(dir, entry.name));
    if (meta) metas.push(meta);
  }
  emitFileEvent({ operation: "READ", path: dir, detail: "artifact index" });
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Remove artifact files that can no longer be restored.
 *
 * An artifact is restorable only when its HTML and valid sidecar metadata are
 * both present and the referenced source JSONL session still exists. Artifact
 * files are derived outputs, so removing an orphan is safe.
 */
export function pruneUnrestorableArtifacts(validSourceSessionIds: ReadonlySet<string>): ArtifactPruneResult {
  const dir = artifactsDir();
  if (!existsSync(dir)) return { artifacts: [], removedIds: [] };

  const ids = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".meta.json")) ids.add(entry.name.slice(0, -".meta.json".length));
    else if (entry.name.endsWith(".html")) ids.add(entry.name.slice(0, -".html".length));
  }

  const artifacts: ArtifactMeta[] = [];
  const removedIds: string[] = [];
  for (const id of ids) {
    const meta = loadArtifactMeta(id);
    const sourceSessionId = meta?.sourceSessionId ?? meta?.sessionId;
    const valid = meta?.sessionId === id
      && existsSync(artifactPath(id))
      && typeof sourceSessionId === "string"
      && validSourceSessionIds.has(sourceSessionId);
    if (valid) {
      artifacts.push(meta);
      continue;
    }
    if (deleteArtifact(id)) removedIds.push(id);
  }

  emitFileEvent({ operation: "READ", path: dir, detail: "validated artifact index" });
  return {
    artifacts: artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    removedIds,
  };
}

export function deleteArtifact(sessionId: string): boolean {
  const htmlPath = artifactPath(sessionId);
  const metaPath = join(artifactsDir(), `${sessionId}.meta.json`);
  let deleted = false;
  if (existsSync(htmlPath)) {
    unlinkSync(htmlPath);
    emitFileEvent({ operation: "DELETE", path: htmlPath, detail: "artifact HTML" });
    deleted = true;
  }
  if (existsSync(metaPath)) {
    unlinkSync(metaPath);
    emitFileEvent({ operation: "DELETE", path: metaPath, detail: "artifact metadata" });
    deleted = true;
  }
  return deleted;
}
