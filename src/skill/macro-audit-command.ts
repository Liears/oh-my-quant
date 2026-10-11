/** Explicit read-only audit of a public macro report; does not run its skill or data provider. */
import type { CommandResult } from "../types/commands.ts";
import { recheckMacroBundle } from "./macro-bundle.ts";
import { auditMacroPresentation, auditMacroReport } from "./macro-report-audit.ts";
import { formatMacroReadableSummary, macroReadableSummary } from "./macro-readable-summary.ts";
import { readBoundedReport, reportAuditFailureCategory } from "./report-audit-files.ts";

type Flags = Record<string, string | number | boolean>;

function warningLines(warnings: string[]): string[] {
  if (!warnings.length) return [];
  return [
    `Warnings: ${warnings.join(", ")}`,
    ...(warnings.includes("markdown-source-label-conflicts-with-json")
      ? ["Use the JSON data_source/data_mode; the Markdown source header is not evidence of an FMP request."] : []),
    ...(warnings.some(warning => warning === "markdown-component-dashboard-mismatch" || warning === "markdown-data-quality-mismatch")
      ? ["Use the audited JSON component scores and data quality; the Markdown dashboard is not verified evidence."] : []),
  ];
}

export function auditMacroCommand(flags: Flags, signal?: AbortSignal): CommandResult {
  const fail = (message: string): CommandResult => ({ success: false, message });
  signal?.throwIfAborted();
  const record = flags.record, json = flags.json, markdown = flags.markdown;
  if (typeof record === "string" && record.trim() && json === undefined && markdown === undefined) {
    try {
      const result = recheckMacroBundle(record);
      signal?.throwIfAborted();
      const readable = result.passed && result.warnings.length === 0;
      return { success: readable, message: [
        `Macro bundle integrity and score audit: ${result.passed ? "passed" : "failed"}`,
        `Human-readable source audit: ${readable ? "passed" : "failed"}`,
        ...(result.violations.length ? [`Violations: ${result.violations.join(", ")}`] : []),
        ...warningLines(result.warnings),
        ...(result.summary ? formatMacroReadableSummary(result.summary) : []),
      ].join("\n"), data: { scope: "pinned-public-bundle", bundlePassed: result.passed,
        humanReadablePassed: readable, violations: result.violations, warnings: result.warnings,
        ...(result.summary ? { summary: result.summary } : {}) } };
    } catch (error) {
      signal?.throwIfAborted();
      return fail(`Macro bundle unavailable (${reportAuditFailureCategory(error)}).`);
    }
  }
  if (typeof json !== "string" || !json.trim() || typeof markdown !== "string" || !markdown.trim() || record !== undefined)
    return fail("Use /skill audit macro-regime-detector --record PATH, or --json REPORT.json --markdown REPORT.md.");
  try {
    const raw = JSON.parse(readBoundedReport(json).toString("utf8"));
    const text = readBoundedReport(markdown).toString("utf8");
    signal?.throwIfAborted();
    const issues = auditMacroReport(raw), warnings = auditMacroPresentation(raw, text);
    const readable = issues.length === 0 && warnings.length === 0;
    const summary = issues.length === 0 ? macroReadableSummary(raw) : null;
    const source = summary?.reportedSource ?? null, dataMode = summary?.dataMode ?? null;
    return { success: readable, message: [
      `Macro report score arithmetic: ${issues.length ? "failed" : "passed"}`,
      `Human-readable report audit: ${readable ? "passed" : "failed"}`,
      `JSON source: ${source ?? "unverified"} · mode: ${dataMode ?? "unverified"}`,
      ...(issues.length ? [`Violations: ${issues.join(", ")}`] : []),
      ...warningLines(warnings),
      ...(summary ? formatMacroReadableSummary(summary) : []),
      "Scope: report consistency only; installed revision and original ETF prices are unverified. Use a pinned public bundle for those checks.",
    ].join("\n"), data: { scope: "report-only", arithmeticPassed: issues.length === 0,
      humanReadablePassed: readable, source, dataMode, score: summary?.compositeScore ?? null,
      violations: issues, warnings, ...(summary ? { summary } : {}) } };
  } catch (error) {
    signal?.throwIfAborted();
    return fail(`Macro report unavailable (${reportAuditFailureCategory(error)}).`);
  }
}
