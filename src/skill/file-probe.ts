import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { SkillRequirementCheck } from "../types/skills.ts";

export const SCRIPT_FILES_REQUIREMENT = "reviewed-script-files";
interface FileEvidence {
  manifest: string;
  files: Readonly<Record<string, string>>;
  checkedAt: string;
  check: SkillRequirementCheck;
}
const observations = new Map<string, Map<string, FileEvidence>>();
const revisions = new Map<string, number>();
const MAX_FILE_BYTES = 256 * 1024;

export function skillFileRevision(cwd: string): number {
  revokeChangedFiles(cwd);
  return revisions.get(resolve(cwd)) ?? 0;
}

export function readSkillFiles(cwd: string, filePath: string, files: Readonly<Record<string, string>>): SkillRequirementCheck {
  revokeChangedFiles(cwd, filePath);
  const evidence = observations.get(resolve(cwd))?.get(resolve(filePath));
  return evidence?.manifest === JSON.stringify(files) ? { ...evidence.check, reason: `${evidence.check.reason} Checked ${evidence.checkedAt}; recheck after local edits or upgrades.` }
    : { requirement: SCRIPT_FILES_REQUIREMENT, status: "unverified", reason: "Run /skill info <name> --check to compare the installed entry and local resources with the reviewed files." };
}

/** Revalidation can revoke an existing success, but cannot grant or restore readiness. */
function revokeChangedFiles(cwd: string, filePath?: string): void {
  const key = resolve(cwd);
  for (const [path, evidence] of observations.get(key) ?? []) {
    if (filePath && path !== resolve(filePath) || evidence.check.status !== "available") continue;
    const current = compareSkillFiles(path, evidence.files);
    if (current.status === "available") continue;
    evidence.check = { ...current, reason: `Previous successful file check invalidated: ${current.reason} Run /skill info <name> --check after resolving the change.` };
    revisions.set(key, (revisions.get(key) ?? 0) + 1);
  }
}

/** Bounded content comparison only. Never import or execute installed code. */
function compareSkillFiles(filePath: string, files: Readonly<Record<string, string>>, signal?: AbortSignal): SkillRequirementCheck {
  signal?.throwIfAborted();
  const failures: string[] = [];
  let missing = false;
  for (const [name, expected] of Object.entries(files)) {
    signal?.throwIfAborted();
    let fd: number | undefined;
    try {
      const root = realpathSync(dirname(filePath)), path = realpathSync(resolve(root, name));
      const within = relative(root, path);
      if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`)) { failures.push(`${name}: outside skill directory`); continue; }
      fd = openSync(path, "r");
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) { failures.push(`${name}: not a bounded regular file`); continue; }
      const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
      let length = 0, count: number;
      while (length < bytes.length && (count = readSync(fd, bytes, length, bytes.length - length, length)) > 0) length += count;
      if (length > MAX_FILE_BYTES) { failures.push(`${name}: file too large`); continue; }
      // Git autocrlf changes line endings on Windows; no other changes are ignored.
      const hash = createHash("sha256").update(bytes.subarray(0, length).toString("utf8").replace(/\r\n/g, "\n")).digest("hex");
      if (hash !== expected) failures.push(`${name}: differs from reviewed content`);
    } catch (error) {
      const absent = error !== null && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
      missing ||= absent;
      failures.push(`${name}: ${absent ? "missing" : "unreadable"}`);
    } finally { if (fd !== undefined) closeSync(fd); }
  }
  signal?.throwIfAborted();
  return { requirement: SCRIPT_FILES_REQUIREMENT,
    status: missing ? "missing" : failures.length || !Object.keys(files).length ? "unverified" : "available",
    reason: failures.length ? failures.join("; ") : Object.keys(files).length
      ? "Installed entry and local resources match reviewed content. Package imports, network access and execution remain separate requirements."
      : "No reviewed file manifest is available." };
}

/** Explicit checking is the only path that can grant or restore a successful observation. */
export function checkSkillFiles(cwd: string, filePath: string, files: Readonly<Record<string, string>>, signal?: AbortSignal): SkillRequirementCheck {
  const check = compareSkillFiles(filePath, files, signal);
  signal?.throwIfAborted();
  const key = resolve(cwd), existing = observations.get(key) ?? new Map<string, FileEvidence>();
  existing.set(resolve(filePath), { manifest: JSON.stringify(files), files: { ...files }, checkedAt: new Date().toISOString(), check });
  observations.set(key, existing);
  revisions.set(key, (revisions.get(key) ?? 0) + 1);
  return { ...check };
}
