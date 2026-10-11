import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { executeCommand, parseCommand } from "../cli/registry.ts";
import { auditPositionCommand } from "./position-audit-command.ts";
import { auditPositionPresentation, auditPositionReport } from "./position-report-audit.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected position audit fixture root.");
    rmSync(root, { recursive: true, force: true });
  }
});

interface FixedReport {
  schema_version: string;
  mode: string;
  parameters: { entry_price: number; account_size: number; stop_price: number; risk_pct: number };
  calculations: { fixed_fractional: { method: string; shares: number; risk_per_share: number; dollar_risk: number; stop_price: number };
    atr_based: null; kelly: null };
  constraints_applied: Array<{ type: string; limit: number; max_shares: number; binding: boolean }>;
  final_recommended_shares: number;
  final_position_value: number;
  final_risk_dollars: number;
  final_risk_pct: number;
  binding_constraint: string | null;
}

function fixedReport(): FixedReport {
  return { schema_version: "1.0", mode: "shares", parameters: { entry_price: 155, account_size: 100000, stop_price: 148.5, risk_pct: 1 },
    calculations: { fixed_fractional: { method: "fixed_fractional", shares: 153, risk_per_share: 6.5, dollar_risk: 1000, stop_price: 148.5 },
      atr_based: null, kelly: null }, constraints_applied: [], final_recommended_shares: 153, final_position_value: 23715,
    final_risk_dollars: 994.5, final_risk_pct: 0.99, binding_constraint: null };
}

function fixedMarkdown() {
  return ["# Position Sizing Report", "**Generated:** 2026-09-19 12:00:00", "**Mode:** shares", "", "## Parameters",
    "- **entry_price:** 155.0", "- **account_size:** 100000", "- **stop_price:** 148.5", "- **risk_pct:** 1.0", "",
    "## Calculations", "### Fixed Fractional", "- shares: 153", "- risk_per_share: 6.5", "- dollar_risk: 1000.0",
    "- stop_price: 148.5", "", "## Final Recommendation", "- **Shares:** 153", "- **Position Value:** $23,715.00",
    "- **Risk:** $994.50 (0.99%)", ""].join("\n");
}

function files(raw: unknown = fixedReport(), markdown = fixedMarkdown()) {
  const root = mkdtempSync(join(tmpdir(), "ohq-position-audit-")); roots.push(root);
  const json = join(root, "PRIVATE_ACCOUNT_REPORT.json"), md = join(root, "PRIVATE_ACCOUNT_REPORT.md");
  writeFileSync(json, JSON.stringify(raw)); writeFileSync(md, markdown);
  return { root, json, markdown: md };
}

test("independently rechecks fixed-fractional arithmetic and every visible result without returning private values", async () => {
  const selected = files();
  const result = await executeCommand(parseCommand(`/skill audit position-sizer --json "${selected.json}" --markdown "${selected.markdown}"`)!);
  expect(result).toMatchObject({ success: true, data: { scope: "private-position-report", arithmeticPassed: true,
    inputBindingPassed: true, humanReadablePassed: true, violations: [], presentationIssues: [] } });
  expect(result.message).toContain("Private values and selected paths are intentionally omitted");
  for (const privateValue of ["100000", "23715", "994.5", "PRIVATE_ACCOUNT_REPORT", selected.root])
    expect(JSON.stringify(result)).not.toContain(privateValue);
});

test("rejects changed JSON arithmetic and a conflicting human-readable risk percentage separately", () => {
  const report = fixedReport(); report.final_risk_dollars = 900;
  expect(auditPositionReport(report).violations).toContain("wrong-final-risk");
  expect(auditPositionPresentation(fixedReport(), fixedMarkdown().replace("(0.99%)", "(9.99%)")))
    .toContain("markdown-final-risk-mismatch");
});

test("checks binding constraints in both JSON and Markdown", () => {
  const report = fixedReport();
  report.constraints_applied = [{ type: "max_position_pct", limit: 10, max_shares: 64, binding: true }];
  report.final_recommended_shares = 64; report.final_position_value = 9920; report.final_risk_dollars = 416;
  report.final_risk_pct = 0.42; report.binding_constraint = "max_position_pct";
  const markdown = fixedMarkdown().replace("## Final Recommendation", "## Constraints\n- max_position_pct: limit=10%, max_shares=64 **[BINDING]**\n\n## Final Recommendation")
    .replace("**Shares:** 153", "**Shares:** 64").replace("$23,715.00", "$9,920.00").replace("$994.50 (0.99%)", "$416.00 (0.42%)")
    + "- **Binding Constraint:** max_position_pct\n";
  expect(auditPositionReport(report).violations).toEqual([]);
  expect(auditPositionPresentation(report, markdown)).toEqual([]);
  expect(auditPositionPresentation(report, markdown.replace("max_shares=64", "max_shares=65"))).toContain("markdown-constraint-mismatch");
});

test("rechecks fractional-share boundaries and Kelly budget inputs", () => {
  const fractional = { schema_version: "1.0", mode: "shares", parameters: { entry_price: 100, account_size: 1150, stop_price: 90,
    risk_pct: 1, fractional_shares: true, share_precision: 2 }, calculations: { fixed_fractional: { method: "fixed_fractional",
      shares: 1.15, risk_per_share: 10, dollar_risk: 11.5, stop_price: 90 }, atr_based: null, kelly: null }, constraints_applied: [],
    final_recommended_shares: 1.15, final_position_value: 115, final_risk_dollars: 11.5, final_risk_pct: 1, binding_constraint: null };
  expect(auditPositionReport(fractional)).toEqual({ violations: [], inputBindingPassed: true, mode: "shares" });
  const budget = { schema_version: "1.0", mode: "budget", parameters: { win_rate: 0.55, avg_win: 2.5, avg_loss: 1, account_size: 100000 },
    calculations: { kelly: { method: "kelly", kelly_pct: 37, half_kelly_pct: 18.5 }, fixed_fractional: null, atr_based: null },
    recommended_risk_budget: 18500, recommended_risk_budget_pct: 18.5, note: "To calculate shares, re-run with --entry and --stop" };
  expect(auditPositionReport(budget)).toEqual({ violations: [], inputBindingPassed: true, mode: "budget" });
  const budgetMarkdown = ["# Position Sizing Report", "**Generated:** 2026-09-19 12:00:00", "**Mode:** budget", "", "## Parameters",
    "- **win_rate:** 0.55", "- **avg_win:** 2.5", "- **avg_loss:** 1.0", "- **account_size:** 100000", "", "## Kelly Criterion",
    "- Full Kelly: 37.0%", "- Half Kelly (recommended): 18.5%", "- **Recommended Risk Budget:** $18,500.00",
    "  (18.5% of account)", "", "*To calculate shares, re-run with --entry and --stop*", ""].join("\n");
  expect(auditPositionPresentation(budget, budgetMarkdown)).toEqual([]);
  expect(auditPositionPresentation(budget, budgetMarkdown.replace("18.5% of account", "19.5% of account")))
    .toContain("markdown-budget-mismatch");
});

test("rechecks ATR arithmetic and its complete human-readable calculation", () => {
  const report = { schema_version: "1.0", mode: "shares", parameters: { entry_price: 155, account_size: 100000,
    stop_price: 148.6, risk_pct: 1 }, calculations: { fixed_fractional: null, atr_based: { method: "atr_based", shares: 156,
    risk_per_share: 6.4, dollar_risk: 1000, stop_price: 148.6, atr: 3.2, atr_multiplier: 2 }, kelly: null },
    constraints_applied: [], final_recommended_shares: 156, final_position_value: 24180, final_risk_dollars: 998.4,
    final_risk_pct: 1, binding_constraint: null };
  const markdown = ["# Position Sizing Report", "**Generated:** 2026-09-19 12:00:00", "**Mode:** shares", "", "## Parameters",
    "- **entry_price:** 155", "- **account_size:** 100000", "- **stop_price:** 148.6", "- **risk_pct:** 1", "", "## Calculations",
    "### Atr Based", "- shares: 156", "- risk_per_share: 6.4", "- dollar_risk: 1000", "- stop_price: 148.6",
    "- atr: 3.2", "- atr_multiplier: 2", "", "## Final Recommendation", "- **Shares:** 156",
    "- **Position Value:** $24,180.00", "- **Risk:** $998.40 (1.0%)", ""].join("\n");
  expect(auditPositionReport(report)).toEqual({ violations: [], inputBindingPassed: true, mode: "shares" });
  expect(auditPositionPresentation(report, markdown)).toEqual([]);
  expect(auditPositionPresentation(report, markdown.replace("- atr: 3.2", "- atr: 4.2")))
    .toContain("markdown-calculation-mismatch");
});

test("does not certify Kelly share recommendations whose original win/loss inputs are absent from the upstream report", () => {
  const report = { schema_version: "1.0", mode: "shares", parameters: { entry_price: 155, account_size: 100000, stop_price: 148.5 },
    calculations: { fixed_fractional: null, atr_based: null, kelly: { method: "kelly", kelly_pct: 37, half_kelly_pct: 18.5 } },
    constraints_applied: [], final_recommended_shares: 2846, final_position_value: 441130, final_risk_dollars: 18499,
    final_risk_pct: 18.5, binding_constraint: null };
  expect(auditPositionReport(report)).toEqual({ violations: [], inputBindingPassed: false, mode: "shares" });
  const selected = files(report, fixedMarkdown());
  const result = auditPositionCommand({ json: selected.json, markdown: selected.markdown });
  expect(result.success).toBe(false);
  expect(result.data).toMatchObject({ arithmeticPassed: true, inputBindingPassed: false });
});

test("reports missing and malformed private files without echoing their path or contents", () => {
  const selected = files();
  const missing = join(selected.root, "PRIVATE_MISSING_ACCOUNT.json");
  const absent = auditPositionCommand({ json: missing, markdown: selected.markdown });
  expect(absent.message).toContain("missing-file");
  expect(JSON.stringify(absent)).not.toContain("PRIVATE_MISSING_ACCOUNT");
  writeFileSync(selected.json, "x".repeat(256 * 1024 + 1));
  const oversized = auditPositionCommand({ json: selected.json, markdown: selected.markdown });
  expect(oversized.message).toContain("invalid-file-size-or-type");
  expect(JSON.stringify(oversized)).not.toContain(selected.root);
  writeFileSync(selected.json, '{"account":"PRIVATE_ACCOUNT_PAYLOAD",}');
  const malformed = auditPositionCommand({ json: selected.json, markdown: selected.markdown });
  expect(malformed.message).toContain("invalid-json");
  expect(JSON.stringify(malformed)).not.toContain("PRIVATE_ACCOUNT_PAYLOAD");
});

test("rejects non-finite derived arithmetic instead of accepting an overflowing account", () => {
  const report = fixedReport();
  report.parameters.account_size = 1e308;
  report.calculations.fixed_fractional.dollar_risk = 1e308;
  report.calculations.fixed_fractional.shares = 1e308;
  report.final_recommended_shares = 1e308; report.final_position_value = 1e308;
  expect(auditPositionReport(report).violations.length).toBeGreaterThan(0);
});

test("does not widen money tolerances for large reports", () => {
  const report = fixedReport();
  report.parameters = { entry_price: 100, account_size: 1_000_000_000, stop_price: 99, risk_pct: 1 };
  report.calculations.fixed_fractional = { method: "fixed_fractional", shares: 10_000_000, risk_per_share: 1,
    dollar_risk: 10_000_000, stop_price: 99 };
  report.final_recommended_shares = 10_000_000; report.final_position_value = 999_999_999;
  report.final_risk_dollars = 10_000_000; report.final_risk_pct = 1;
  expect(auditPositionReport(report).violations).toContain("wrong-final-position");
});
