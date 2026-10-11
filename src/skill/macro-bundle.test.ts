import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { recheckMacroBundle } from "./macro-bundle.ts";
import { MACRO_REVIEWED_FILES } from "./macro-manifest.ts";
import { MACRO_ETFS, parseMacroInput } from "./macro-input-audit.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected macro bundle fixture root.");
    rmSync(root, { recursive: true, force: true });
  }
});

function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

function presentation(score: number, zone: string, signaling: number, source = "yfinance"): Buffer {
  const rows = [
    ["Market Concentration (RSP/SPY)", 25], ["Yield Curve (10Y-2Y)", 20],
    ["Credit Conditions (HYG/LQD)", 15], ["Size Factor (IWM/SPY)", 15],
    ["Equity-Bond (SPY/TLT)", 15], ["Sector Rotation (XLY/XLP)", 10],
  ] as const;
  return Buffer.from([
    `**Data Source:** ${source}`,
    `| **Transition Score** | **${score}/100** |`,
    `| **Signal Zone** | ${zone} |`,
    `| **Components Signaling** | ${signaling}/6 |`,
    "| **Data Quality** | Complete (6/6 components) |",
    "## 2. Transition Signal Dashboard",
    ...rows.map(([label, weight], index) => `| ${index + 1} | **${label}** | ${weight}% | ███░ ${score} |`),
    "## 3. Component Details",
  ].join("\n"));
}

function fixture(): { path: string; bundle: string; record: Record<string, unknown> } {
  const root = mkdtempSync(join(tmpdir(), "ohq-macro-bundle-")); roots.push(root);
  const path = join(root, "record.json"), bundle = `${path}.bundle`;
  mkdirSync(bundle);
  const weights = { concentration: 0.25, yield_curve: 0.20, credit_conditions: 0.15,
    size_factor: 0.15, equity_bond: 0.15, sector_rotation: 0.10 } as const;
  const components = Object.fromEntries(Object.keys(weights).map(key => [key, { score: 50, data_available: true }]));
  const component_scores = Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key,
    { score: 50, weight, weighted_contribution: 50 * weight }]));
  const report = { metadata: { data_source: "yfinance", data_mode: "yfinance_only", treasury_data_available: false,
    etfs_analyzed: ["RSP", "SPY", "IWM", "TLT", "SHY", "HYG", "LQD", "XLY", "XLP"] },
  components, composite: { composite_score: 50, zone: "Transition Zone (Preparing)",
    data_quality: { available_count: 6, total_components: 6 }, signaling_components: 6,
    strongest_signal: { component: "concentration", score: 50 },
    weakest_signal: { component: "concentration", score: 50 }, component_scores } };
  const json = Buffer.from(JSON.stringify(report)), markdown = presentation(50, "Transition Zone (Preparing)", 6);
  writeFileSync(join(bundle, "report.json"), json);
  writeFileSync(join(bundle, "report.md"), markdown);
  const record = { source: "https://raw.githubusercontent.com/tradermonty/claude-trading-skills/a2506fd1bab662723fb7142734320fef23fc48fa/skills/macro-regime-detector",
    reviewedFiles: MACRO_REVIEWED_FILES,
    publicScript: { exitCode: 0, dataMode: "yfinance_only", etfsAnalyzed: 9, treasuryDataAvailable: false,
      componentCount: 6, finiteComposite: true, arithmeticAudit: [], presentationAuditVersion: 2, presentationAudit: [],
      etfBars: Object.fromEntries(report.metadata.etfs_analyzed.map(symbol => [symbol, 600])), failedEtfs: [],
      reportArchive: "record.json.bundle/report.json", reportSha256: digest(json), reportBytes: json.length,
      markdownArchive: "record.json.bundle/report.md", markdownSha256: digest(markdown), markdownBytes: markdown.length } };
  writeFileSync(path, JSON.stringify(record));
  return { path, bundle, record };
}

function capturedFixture(): ReturnType<typeof fixture> {
  const captured = fixture(), inputDir = join(captured.bundle, "inputs");
  mkdirSync(inputDir);
  const last = new Date("2026-09-15T00:00:00.000Z");
  const history = Array.from({ length: 600 }, (_, index) => {
    const day = new Date(last); day.setUTCDate(last.getUTCDate() - index);
    return { date: day.toISOString().slice(0, 10), open: 100, high: 100, low: 100,
      close: 100, adjClose: 100, volume: 1000 };
  });
  const months = new Set(history.map(row => row.date.slice(0, 7))).size;
  const archives: Record<string, unknown> = {};
  for (const symbol of MACRO_ETFS) {
    const bytes = Buffer.from(JSON.stringify({ symbol, historical: history }));
    writeFileSync(join(inputDir, `${symbol}.json`), bytes);
    archives[symbol] = { archive: `record.json.bundle/inputs/${symbol}.json`, sha256: digest(bytes), bytes: bytes.length,
      ...parseMacroInput(JSON.parse(bytes.toString("utf8")), symbol).receipt };
  }
  const report = JSON.parse(readFileSync(join(captured.bundle, "report.json"), "utf8"));
  for (const component of Object.values(report.components) as Array<Record<string, unknown>>) Object.assign(component,
    { score: 25, current_date: "2026-09-15", current_ratio: 1, proxy_ratio: 1, monthly_points: months,
      sma_6m: 1, sma_12m: 1, roc_3m: 0, roc_12m: 0, percentile: 0,
      crossover: { type: "converging", bars_ago: null, gap_pct: 0 }, momentum_qualifier: "N/A" });
  report.components.concentration.direction = "concentrating";
  report.components.yield_curve.direction = "stable";
  report.components.credit_conditions.direction = "stable";
  report.components.size_factor.direction = "neutral";
  report.components.equity_bond.direction = "neutral";
  report.components.equity_bond.correlation_6m = 0;
  report.components.equity_bond.correlation_12m = 0;
  report.components.equity_bond.correlation_regime = "near_zero";
  report.components.sector_rotation.direction = "neutral";
  report.composite.composite_score = 25;
  report.composite.zone = "Early Signal (Monitoring)";
  report.composite.signaling_components = 0;
  report.composite.strongest_signal.score = 25;
  report.composite.weakest_signal.score = 25;
  for (const row of Object.values(report.composite.component_scores) as Array<{ score: number; weight: number; weighted_contribution: number }>) {
    row.score = 25;
    const scaled = 25 * row.weight * 10, lower = Math.floor(scaled);
    row.weighted_contribution = (Math.abs(scaled - lower - 0.5) < 1e-8 ? lower + lower % 2 : Math.round(scaled)) / 10;
  }
  const reportBytes = Buffer.from(JSON.stringify(report));
  writeFileSync(join(captured.bundle, "report.json"), reportBytes);
  const markdown = presentation(25, "Early Signal (Monitoring)", 0);
  writeFileSync(join(captured.bundle, "report.md"), markdown);
  const script = captured.record.publicScript as Record<string, unknown>;
  script.reportSha256 = digest(reportBytes); script.reportBytes = reportBytes.length;
  script.markdownSha256 = digest(markdown); script.markdownBytes = markdown.length;
  script.inputArchives = archives; script.inputAudit = []; script.scoreAudit = [];
  captured.record.scope = "instrumented price-client input capture";
  writeFileSync(captured.path, JSON.stringify(captured.record));
  return captured;
}

test("offline macro bundle replays a complete pinned public receipt", () => {
  const captured = fixture();
  const result = recheckMacroBundle(captured.path);
  expect(result).toMatchObject({ passed: true, violations: [], warnings: [], summary: {
    reportedSource: "yfinance", compositeScore: 50, signalingComponents: 6,
  } });
  expect(result.summary?.components[0]).toEqual({ name: "concentration", score: 50, weightPercent: 25 });
});

test("offline macro bundle refuses an oversized record before parsing it", () => {
  const captured = fixture();
  writeFileSync(captured.path, "x".repeat(1024 * 1024 + 1));
  expect(() => recheckMacroBundle(captured.path)).toThrow("bounded regular file");
});

test("offline macro bundle detects modified bytes and independently forged composite arithmetic", () => {
  const captured = fixture();
  writeFileSync(join(captured.bundle, "report.md"), "changed report");
  expect(recheckMacroBundle(captured.path).violations).toContain("markdown-hash-or-size");
  const report = JSON.parse(readFileSync(join(captured.bundle, "report.json"), "utf8"));
  report.composite.composite_score = 90;
  const bytes = Buffer.from(JSON.stringify(report));
  writeFileSync(join(captured.bundle, "report.json"), bytes);
  const script = captured.record.publicScript as Record<string, unknown>;
  script.reportSha256 = digest(bytes); script.reportBytes = bytes.length;
  writeFileSync(captured.path, JSON.stringify(captured.record));
  const result = recheckMacroBundle(captured.path);
  expect(result.violations).toContain("wrong-composite-arithmetic");
  expect(result.summary).toBeUndefined();
});

test("offline macro bundle rejects a path outside its companion bundle", () => {
  const captured = fixture();
  const script = captured.record.publicScript as Record<string, unknown>;
  script.reportArchive = "record.json";
  writeFileSync(captured.path, JSON.stringify(captured.record));
  expect(() => recheckMacroBundle(captured.path)).toThrow("leaves the verification bundle");
});

test("offline macro bundle preserves and rechecks a human-readable source warning", () => {
  const captured = fixture();
  const markdown = presentation(50, "Transition Zone (Preparing)", 6, "FMP API (0 calls)");
  writeFileSync(join(captured.bundle, "report.md"), markdown);
  const script = captured.record.publicScript as Record<string, unknown>;
  script.markdownSha256 = digest(markdown); script.markdownBytes = markdown.length;
  script.presentationAudit = ["markdown-source-label-conflicts-with-json"];
  writeFileSync(captured.path, JSON.stringify(captured.record));
  expect(recheckMacroBundle(captured.path)).toMatchObject({ passed: true, violations: [],
    warnings: ["markdown-source-label-conflicts-with-json"] });
  script.presentationAudit = [];
  writeFileSync(captured.path, JSON.stringify(captured.record));
  expect(recheckMacroBundle(captured.path).violations).toContain("presentation-audit-receipt-mismatch");
});

test("older macro receipts retain their original audit proof while exposing new Markdown gaps", () => {
  const captured = fixture(), script = captured.record.publicScript as Record<string, unknown>;
  delete script.presentationAuditVersion;
  const markdown = Buffer.from("**Data Source:** yfinance\n| **Transition Score** | **50/100** |\n| **Signal Zone** | Transition Zone (Preparing) |");
  writeFileSync(join(captured.bundle, "report.md"), markdown);
  script.markdownSha256 = digest(markdown); script.markdownBytes = markdown.length;
  writeFileSync(captured.path, JSON.stringify(captured.record));
  expect(recheckMacroBundle(captured.path)).toMatchObject({ passed: true, violations: [], warnings: [
    "markdown-data-quality-mismatch", "markdown-component-dashboard-mismatch",
  ] });
  script.presentationAuditVersion = 3;
  writeFileSync(captured.path, JSON.stringify(captured.record));
  expect(recheckMacroBundle(captured.path).violations).toContain("unsupported-presentation-audit-version");
});

test("offline macro bundle replays nine captured price responses and detects their later corruption", () => {
  const captured = capturedFixture();
  expect(recheckMacroBundle(captured.path)).toMatchObject({ passed: true, violations: [], warnings: [], summary: {
    compositeScore: 25, availableComponents: 6, signalingComponents: 0,
  } });
  writeFileSync(join(captured.bundle, "inputs", "RSP.json"), "corrupted price response");
  const result = recheckMacroBundle(captured.path);
  expect(result.passed).toBe(false);
  expect(result.violations).toEqual(expect.arrayContaining(["input-RSP-hash-or-size", "invalid-input-RSP"]));
});

test("offline replay catches a forged direction even after the report and receipt hashes are updated", () => {
  const captured = capturedFixture();
  const reportPath = join(captured.bundle, "report.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  report.components.concentration.direction = "broadening";
  const bytes = Buffer.from(JSON.stringify(report));
  writeFileSync(reportPath, bytes);
  const script = captured.record.publicScript as Record<string, unknown>;
  script.reportSha256 = digest(bytes); script.reportBytes = bytes.length;
  writeFileSync(captured.path, JSON.stringify(captured.record));
  expect(recheckMacroBundle(captured.path).violations).toContain("wrong-direction-concentration");
});
