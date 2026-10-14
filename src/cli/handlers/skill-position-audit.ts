/** Explicit local audit of a private position-sizing report; never returns account values or paths. */
import type { CommandResult } from "../../types/commands.ts";
import { auditPositionPresentation, auditPositionReport } from "../../skill/index.ts";
import { readBoundedReport, reportAuditFailureCategory } from "./skill-audit-files.ts";

type Flags = Record<string, string | number | boolean>;

export function auditPositionCommand(flags: Flags, signal?: AbortSignal): CommandResult {
  const json = flags.json, markdown = flags.markdown;
  if (typeof json !== "string" || !json.trim() || typeof markdown !== "string" || !markdown.trim() || flags.record !== undefined) {
    return { success: false, message: "Use /skill audit position-sizer --json REPORT.json --markdown REPORT.md." };
  }
  try {
    signal?.throwIfAborted();
    const raw = JSON.parse(readBoundedReport(json).toString("utf8"));
    const text = readBoundedReport(markdown).toString("utf8");
    signal?.throwIfAborted();
    const audit = auditPositionReport(raw), presentation = auditPositionPresentation(raw, text);
    const passed = audit.violations.length === 0 && presentation.length === 0 && audit.inputBindingPassed;
    return { success: passed, message: [
      `Position arithmetic audit: ${audit.violations.length ? "failed" : "passed"}`,
      `Input binding audit: ${audit.inputBindingPassed ? "passed" : "failed"}`,
      `Human-readable report audit: ${presentation.length ? "failed" : "passed"}`,
      ...(audit.violations.length ? [`Violations: ${audit.violations.join(", ")}`] : []),
      ...(presentation.length ? [`Presentation issues: ${presentation.join(", ")}`] : []),
      "Private values and selected paths are intentionally omitted. This read-only audit does not authorize Agent invocation or report persistence.",
    ].join("\n"), data: { scope: "private-position-report", arithmeticPassed: audit.violations.length === 0,
      inputBindingPassed: audit.inputBindingPassed, humanReadablePassed: presentation.length === 0,
      violations: audit.violations, presentationIssues: presentation } };
  } catch (error) {
    signal?.throwIfAborted();
    return { success: false, message: `Position report unavailable (${reportAuditFailureCategory(error)}).` };
  }
}
