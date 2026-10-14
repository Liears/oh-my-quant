import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { atomicWriteJson } from "./atomic-file.ts";
import { emitFileEvent } from "./fs-events.ts";

export function invalidStorageFile(path: string): Error {
  return Object.assign(new Error(`${basename(path)} is invalid. Repair or restore the file before retrying; it has not been replaced.`), { code: "ESTORAGEFORMAT" });
}

/** Exact disk bytes identify the draft's base, including edits made outside this app. */
export function readDurableJson(path: string): { value: Record<string, unknown> | null; revision: string } {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { value: null, revision: "missing" };
    throw error;
  }
  emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(text), detail: "durable preferences" });
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw invalidStorageFile(path); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidStorageFile(path);
  return { value: value as Record<string, unknown>, revision: createHash("sha256").update(text).digest("hex") };
}

export async function readDurableJsonAsync(
  path: string, signal?: AbortSignal,
): Promise<{ value: Record<string, unknown> | null; revision: string }> {
  signal?.throwIfAborted();
  let text: string;
  try { text = await readFile(path, { encoding: "utf8", signal }); } catch (error) {
    signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { value: null, revision: "missing" };
    throw error;
  }
  emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(text), detail: "durable preferences" });
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw invalidStorageFile(path); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidStorageFile(path);
  return { value: value as Record<string, unknown>, revision: createHash("sha256").update(text).digest("hex") };
}

/** Must run under the same lock as the subsequent write. Missing revision never authorizes replacement. */
export function assertStorageRevision(path: string, expected: string | undefined, actual: string): void {
  if ((expected ?? "missing") !== actual) {
    throw Object.assign(new Error(`${basename(path)} changed. Reopen the editor to load the latest version; your draft was not saved.`), { code: "ESTORAGECONFLICT" });
  }
}

/** Caller owns the lock. Return the committed revision without an unlocked second read. */
export function writeDurableJson(path: string, value: unknown): string {
  const bytes = atomicWriteJson(path, value);
  const revision = createHash("sha256").update(JSON.stringify(value, null, 2)).digest("hex");
  emitFileEvent({ operation: "WRITE", path, bytes, detail: "durable preferences" });
  return revision;
}
