/** Offline integrity and score-arithmetic replay for one pinned public macro report. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { auditMacroPresentation, auditMacroReport } from "./macro-report-audit.ts";
import { auditMacroPresentationV1 } from "./macro-presentation-audit.ts";
import { MACRO_REVIEWED_FILES } from "./macro-manifest.ts";
import { auditMacroReportFromInputs, MACRO_ETFS, parseMacroInput, type MacroEtf, type MacroPriceBar } from "./macro-input-audit.ts";
import { auditMacroScoresFromInputs } from "./macro-score-audit.ts";
import { macroReadableSummary, type MacroReadableSummary } from "./macro-readable-summary.ts";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

export function recheckMacroBundle(recordFile: string): { passed: boolean; violations: string[]; warnings: string[]; summary?: MacroReadableSummary } {
  const path = resolve(recordFile), recordStat = statSync(path);
  if (!recordStat.isFile() || recordStat.size > 1024 * 1024) throw new Error("Macro verification record is not a bounded regular file.");
  const recordBytes = readFileSync(path);
  if (recordBytes.length > 1024 * 1024) throw new Error("Macro verification record is too large.");
  const record = object(JSON.parse(recordBytes.toString("utf8"))), script = object(record?.publicScript);
  if (!record || !script || script.exitCode !== 0) throw new Error("Incomplete successful public macro verification record.");
  const bundle = realpathSync(`${path}.bundle`), issues: string[] = [];
  const read = (archive: unknown, expectedHash: unknown, expectedBytes: unknown, label: string): Buffer => {
    if (typeof archive !== "string" || typeof expectedHash !== "string" || typeof expectedBytes !== "number")
      throw new Error("Incomplete macro bundle entry.");
    const target = realpathSync(resolve(dirname(path), archive)), within = relative(bundle, target);
    if (!within || isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`))
      throw new Error("Macro archive path leaves the verification bundle.");
    const stat = statSync(target);
    if (!stat.isFile() || stat.size > 256 * 1024) throw new Error("Macro archive is not a bounded regular file.");
    const bytes = readFileSync(target);
    if (digest(bytes) !== expectedHash || bytes.length !== expectedBytes) issues.push(`${label}-hash-or-size`);
    return bytes;
  };
  const reportBytes = read(script.reportArchive, script.reportSha256, script.reportBytes, "report");
  const markdownBytes = read(script.markdownArchive, script.markdownSha256, script.markdownBytes, "markdown");
  const report = object(JSON.parse(reportBytes.toString("utf8"))), metadata = object(report?.metadata);
  const composite = object(report?.composite), components = object(report?.components);
  issues.push(...auditMacroReport(report));
  const markdown = markdownBytes.toString("utf8");
  const warnings = auditMacroPresentation(report, markdown);
  const receiptAudit = script.presentationAuditVersion === 2 ? warnings : auditMacroPresentationV1(report, markdown);
  if (!isDeepStrictEqual(receiptAudit, script.presentationAudit)) issues.push("presentation-audit-receipt-mismatch");
  if (script.presentationAuditVersion !== undefined && script.presentationAuditVersion !== 2)
    issues.push("unsupported-presentation-audit-version");
  if (!Array.isArray(script.arithmeticAudit) || script.arithmeticAudit.length !== 0
    || script.dataMode !== metadata?.data_mode || script.etfsAnalyzed !== (metadata?.etfs_analyzed as unknown[])?.length
    || script.componentCount !== Object.keys(components ?? {}).length || script.finiteComposite !== true
    || script.treasuryDataAvailable !== (metadata?.treasury_data_available === true)
    || !markdownBytes.length) issues.push("record-report-summary-mismatch");
  const files = object(record.reviewedFiles);
  if (!files || Object.keys(files).length !== Object.keys(MACRO_REVIEWED_FILES).length
    || Object.entries(MACRO_REVIEWED_FILES).some(([name, hash]) => files[name] !== hash))
    issues.push("wrong-pinned-script-files");
  const etfs = object(script.etfBars);
  if (!etfs || Object.keys(etfs).length !== MACRO_ETFS.length || MACRO_ETFS.some(symbol => typeof etfs[symbol] !== "number"
    || !Number.isInteger(etfs[symbol]) || (etfs[symbol] as number) < 400)
    || !Array.isArray(script.failedEtfs) || script.failedEtfs.length) issues.push("wrong-etf-coverage-receipt");
  const archives = object(script.inputArchives);
  if (archives) {
    if (Object.keys(archives).length !== MACRO_ETFS.length || !Array.isArray(script.inputAudit) || script.inputAudit.length)
      issues.push("incomplete-input-capture-receipt");
    const captured: Partial<Record<MacroEtf, MacroPriceBar[]>> = {};
    for (const symbol of MACRO_ETFS) {
      const archive = object(archives[symbol]);
      if (!archive) { issues.push(`missing-input-archive-${symbol}`); continue; }
      const bytes = read(archive.archive, archive.sha256, archive.bytes, `input-${symbol}`);
      try {
        const { bars, receipt } = parseMacroInput(JSON.parse(bytes.toString("utf8")), symbol);
        captured[symbol] = bars;
        if (archive.rows !== receipt.rows || archive.oldestDate !== receipt.oldestDate
          || archive.latestDate !== receipt.latestDate || etfs?.[symbol] !== receipt.rows)
          issues.push(`wrong-input-coverage-${symbol}`);
      } catch { issues.push(`invalid-input-${symbol}`); }
    }
    if (MACRO_ETFS.every(symbol => captured[symbol])) {
      const inputs = captured as Record<MacroEtf, MacroPriceBar[]>;
      issues.push(...auditMacroReportFromInputs(report, inputs));
      const scoreAudit = auditMacroScoresFromInputs(report, inputs);
      issues.push(...scoreAudit);
      if (script.scoreAudit !== undefined && !isDeepStrictEqual(script.scoreAudit, scoreAudit))
        issues.push("score-audit-receipt-mismatch");
    }
    if (typeof record.scope !== "string" || !record.scope.includes("instrumented price-client input capture"))
      issues.push("wrong-input-capture-scope");
  } else if (script.inputAudit !== undefined || script.scoreAudit !== undefined) issues.push("input-audit-without-archives");
  if (record.source !== "https://raw.githubusercontent.com/tradermonty/claude-trading-skills/a2506fd1bab662723fb7142734320fef23fc48fa/skills/macro-regime-detector")
    issues.push("wrong-source-revision");
  if (composite?.composite_score === undefined) issues.push("missing-composite");
  const passed = issues.length === 0;
  const summary = passed ? macroReadableSummary(report) : null;
  return { passed, violations: issues, warnings, ...(summary ? { summary } : {}) };
}
