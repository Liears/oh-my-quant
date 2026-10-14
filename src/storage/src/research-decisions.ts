import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ResearchDecision, ResearchDecisionRequest } from "../../types/research-decision.ts";
import { resolveOhquantDir } from "./dirs.ts";
import { atomicWriteJson, withFileLock } from "./atomic-file.ts";
import { emitFileEvent } from "./fs-events.ts";

export function researchDecisionHash(decision: ResearchDecision): string {
  return createHash("sha256").update(JSON.stringify(decision)).digest("hex");
}
function decisionPath(id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid research decision ID.");
  return join(resolveOhquantDir(), "research", "decisions", `${id}.json`);
}
export function loadResearchDecision(id: string): ResearchDecision {
  const path = decisionPath(id), text = readFileSync(path, "utf8");
  emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(text), detail: "research decision" });
  const envelope = JSON.parse(text) as { decision?: ResearchDecision; hash?: string } | null;
  const decision = envelope?.decision;
  if (!decision || decision.id !== id || decision.version !== 1 || decision.kind !== "research-decision"
    || decision.provenance !== "explicit-tool-input" || typeof decision.recordedAt !== "string" || !Number.isFinite(Date.parse(decision.recordedAt))
    || !decision.request || typeof decision.request.requestId !== "string" || createHash("sha256").update(decision.request.requestId).digest("hex") !== id
    || typeof decision.comparisonHash !== "string" || !/^[a-f0-9]{64}$/.test(decision.comparisonHash)
    || researchDecisionHash(decision) !== envelope?.hash) throw new Error("Research decision integrity check failed; original file preserved.");
  return decision;
}
/** One request ID commits once. A different payload with the same ID is a conflict, not an edit. */
export function saveResearchDecision(request: ResearchDecisionRequest, comparisonHash: string): ResearchDecision {
  const id = createHash("sha256").update(request.requestId).digest("hex"), path = decisionPath(id);
  const dir = join(resolveOhquantDir(), "research", "decisions");
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); emitFileEvent({ operation: "MKDIR", path: dir, detail: "research decisions" }); }
  return withFileLock(path, () => {
    if (existsSync(path)) {
      const existing = loadResearchDecision(id);
      if (!isDeepStrictEqual(existing.request, request) || existing.comparisonHash !== comparisonHash) throw new Error("Research decision request ID already has different content; original preserved.");
      return existing;
    }
    const decision: ResearchDecision = { version: 1, kind: "research-decision", id, recordedAt: new Date().toISOString(), provenance: "explicit-tool-input", request: structuredClone(request), comparisonHash };
    const bytes = atomicWriteJson(path, { decision, hash: researchDecisionHash(decision) });
    emitFileEvent({ operation: "WRITE", path, bytes, detail: "immutable research decision" });
    return decision;
  });
}
export function listResearchDecisionFiles(): string[] {
  const dir = join(resolveOhquantDir(), "research", "decisions");
  return existsSync(dir) ? readdirSync(dir).filter(file => file.endsWith(".json")).sort() : [];
}
