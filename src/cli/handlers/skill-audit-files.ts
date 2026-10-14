import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function reportAuditFailureCategory(error: unknown): string {
  if (error instanceof SyntaxError) return "invalid-json";
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "ENOENT" || code === "ENOTDIR") return "missing-file";
  if (code === "EACCES" || code === "EPERM") return "unreadable-file";
  if (error instanceof Error && /bounded regular file|too large/i.test(error.message)) return "invalid-file-size-or-type";
  if (error instanceof Error && /archive path leaves/i.test(error.message)) return "invalid-bundle-path";
  return "invalid-report-or-bundle";
}

export function readBoundedReport(path: string, maximum = 256 * 1024): Buffer {
  const target = resolve(path), stat = statSync(target);
  if (!stat.isFile() || stat.size > maximum) throw new Error("Selected report is not a bounded regular file.");
  return readFileSync(target);
}
