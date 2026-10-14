/** Offline receipt check for a previously captured public breadth run. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { auditBreadthReport } from "./breadth-report-audit.ts";

type Entry = { archive: string; sha256: string; bytes?: number; rows?: number };
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function entry(value: unknown): Entry {
  const item = object(value);
  if (!item || typeof item.archive !== "string" || typeof item.sha256 !== "string") throw new Error("Incomplete breadth bundle entry.");
  return item as Entry;
}
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

export function recheckBreadthBundle(recordFile: string): { passed: boolean; violations: string[] } {
  const path = resolve(recordFile), recordBytes = readFileSync(path);
  if (recordBytes.length > 1024 * 1024) throw new Error("Breadth verification record is too large.");
  const record = object(JSON.parse(recordBytes.toString("utf8"))), input = object(record?.input), output = object(record?.output);
  if (!record || !input || !output) throw new Error("Incomplete breadth verification record.");
  const bundle = realpathSync(`${path}.bundle`), issues: string[] = [];
  const read = (value: unknown, limit: number, label: string): Buffer => {
    const file = entry(value), target = realpathSync(resolve(dirname(path), file.archive)), within = relative(bundle, target);
    if (!within || isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`)) throw new Error("Breadth archive path leaves the verification bundle.");
    const stat = statSync(target);
    if (!stat.isFile() || stat.size > limit) throw new Error("Breadth archive is not a bounded regular file.");
    const bytes = readFileSync(target);
    if (digest(bytes) !== file.sha256 || file.bytes !== undefined && bytes.length !== file.bytes) issues.push(`${label}-hash-or-size`);
    return bytes;
  };
  const detail = read(input.detail, 4 * 1024 * 1024, "detail"), summary = read(input.summary, 4 * 1024 * 1024, "summary");
  const reportBytes = read({ archive: output.reportArchive, sha256: output.reportSha256 }, 256 * 1024, "report");
  const markdown = read({ archive: output.markdownArchive, sha256: output.markdownSha256 }, 256 * 1024, "markdown");
  const historyBytes = read({ archive: output.historyArchive, sha256: output.historySha256 }, 256 * 1024, "history");
  const report: unknown = JSON.parse(reportBytes.toString("utf8")), history: unknown = JSON.parse(historyBytes.toString("utf8"));
  if (!isDeepStrictEqual(report, record.scriptReport)) issues.push("report-does-not-match-record");
  const rows = detail.toString("utf8").trimEnd().split(/\r?\n/u);
  const summaryRows = summary.toString("utf8").trimEnd().split(/\r?\n/u);
  const dates = rows.slice(1).map(row => /^\d{4}-\d{2}-\d{2}(?=,)/u.exec(row)?.[0]);
  const latest = dates.every(Boolean) && rows[0]?.startsWith("Date,") ? dates.sort().at(-1) : undefined;
  if (rows.length - 1 !== entry(input.detail).rows || summaryRows.length - 1 !== entry(input.summary).rows
    || latest !== input.latestDate) issues.push("archive-input-identity");
  issues.push(...auditBreadthReport(report, { detailRows: rows.length - 1, latestDate: String(latest ?? "") }));
  const composite = object(object(report)?.composite), text = markdown.toString("utf8");
  if (composite?.composite_score !== output.score || composite?.zone !== output.zone
    || !text.includes(`**${output.score}/100**`) || !text.includes(String(input.latestDate)) || !text.includes(String(output.zone)))
    issues.push("markdown-or-score-mismatch");
  const lastHistory = Array.isArray(history) ? object(history.at(-1)) : null;
  if (!lastHistory || lastHistory.data_date !== input.latestDate || lastHistory.composite_score !== output.score)
    issues.push("history-mismatch");
  return { passed: issues.length === 0, violations: issues };
}
