import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ModelOAuthFile, readPiConfigSnapshot, readSettings, saveSettings } from "../../storage/index.ts";
import { listPiConnections, mapPiConnection } from "../../agent/src/pi-config-import.ts";

export interface PiImportSelection { directory?: string; provider?: string; model?: string }

function piDirectory(directory?: string): string {
  const selected = directory ?? (process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));
  if (selected === "~") return homedir();
  return /^~[/\\]/.test(selected) ? join(homedir(), selected.slice(2)) : selected;
}

export function inspectPiImport(selection: PiImportSelection, review?: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const directory = resolve(piDirectory(selection.directory));
  const snapshot = readPiConfigSnapshot(directory), current = readSettings();
  const mapped = mapPiConnection(snapshot, current, selection, { ...process.env });
  const token = createHash("sha256").update(JSON.stringify({ source: snapshot.revision, current: current.revision, draft: mapped.draft })).digest("hex");
  if (review !== undefined) {
    if (review !== token) throw new Error("Pi import preview is stale or missing. Preview again; no settings changed.");
    signal?.throwIfAborted();
    // saveSettings checks the same settings revision under its process lock.
    const authPath = join(directory, "auth.json"), provider = mapped.summary.targetProvider;
    const previousId = mapped.oauthLinked ? current.providers?.[provider]?.oauthId : undefined;
    let reusedId: string | undefined;
    if (previousId) {
      try { if (new ModelOAuthFile(provider, previousId).readPiLink() === authPath) reusedId = previousId; }
      catch { /* A damaged old reference is retained while a new link is prepared. */ }
    }
    const link = mapped.oauthLinked && !reusedId ? ModelOAuthFile.createPiLink(provider, authPath) : undefined;
    try {
      if (mapped.oauthLinked) mapped.draft.providers![provider]!.oauthId = reusedId ?? link!.id;
      saveSettings(mapped.draft);
    } catch (error) { link?.discardUnpublished(); throw error; }
  }
  return { ...mapped.summary, review: token, applied: review !== undefined };
}

export function inspectPiConnections(directory?: string) {
  return listPiConnections(readPiConfigSnapshot(piDirectory(directory)));
}
