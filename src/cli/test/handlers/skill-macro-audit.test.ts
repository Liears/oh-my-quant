import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { executeCommand, parseCommand } from "../../registry.ts";
import { auditMacroCommand } from "../../handlers/skill-macro-audit.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected macro audit fixture root.");
    rmSync(root, { recursive: true, force: true });
  }
});

function reportFiles(): { root: string; json: string; markdown: string } {
  const root = mkdtempSync(join(tmpdir(), "ohq-macro-audit-")); roots.push(root);
  const json = join(root, "macro.json"), markdown = join(root, "macro.md");
  const weights = { concentration: 0.25, yield_curve: 0.20, credit_conditions: 0.15,
    size_factor: 0.15, equity_bond: 0.15, sector_rotation: 0.10 } as const;
  const components = Object.fromEntries(Object.keys(weights).map(key => [key, { score: 50, data_available: true }]));
  const component_scores = Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key,
    { score: 50, weight, weighted_contribution: 50 * weight }]));
  writeFileSync(json, JSON.stringify({ metadata: { data_source: "yfinance", data_mode: "yfinance_only",
    etfs_analyzed: ["RSP", "SPY", "IWM", "TLT", "SHY", "HYG", "LQD", "XLY", "XLP"] },
  components, composite: { composite_score: 50, zone: "Transition Zone (Preparing)",
    data_quality: { available_count: 6, total_components: 6 }, signaling_components: 6,
    strongest_signal: { component: "concentration", score: 50 }, weakest_signal: { component: "concentration", score: 50 },
    component_scores } }));
  writeFileSync(markdown, [
    "**Data Source:** FMP API (0 calls)",
    "| **Transition Score** | **50/100** |",
    "| **Signal Zone** | Transition Zone (Preparing) |",
    "| **Components Signaling** | 6/6 |",
    "| **Data Quality** | Complete (6/6 components) |",
    "## 2. Transition Signal Dashboard",
    "| 1 | **Market Concentration (RSP/SPY)** | 25% | ███░ 50 |",
    "| 2 | **Yield Curve (10Y-2Y)** | 20% | ███░ 50 |",
    "| 3 | **Credit Conditions (HYG/LQD)** | 15% | ███░ 50 |",
    "| 4 | **Size Factor (IWM/SPY)** | 15% | ███░ 50 |",
    "| 5 | **Equity-Bond (SPY/TLT)** | 15% | ███░ 50 |",
    "| 6 | **Sector Rotation (XLY/XLP)** | 10% | ███░ 50 |",
    "## 3. Component Details",
  ].join("\n"));
  return { root, json, markdown };
}

test("skill audit blocks the pinned Markdown's false FMP source while preserving JSON arithmetic evidence", async () => {
  const files = reportFiles();
  const command = parseCommand(`/skill audit macro-regime-detector --json "${files.json}" --markdown "${files.markdown}"`)!;
  const result = await executeCommand(command);
  expect(result.success).toBe(false);
  expect(result.data).toMatchObject({ scope: "report-only", arithmeticPassed: true, humanReadablePassed: false,
    source: "yfinance", dataMode: "yfinance_only", warnings: ["markdown-source-label-conflicts-with-json"],
    summary: { reportedSource: "yfinance", compositeScore: 50, signalingComponents: 6 } });
  expect(result.message).toContain("Markdown source header is not evidence of an FMP request");
  expect(result.message).toContain("Audited JSON figures (reported source; narrative guidance unreviewed)");
  writeFileSync(files.markdown, readFileSync(files.markdown, "utf8").replace("FMP API (0 calls)", "yfinance"));
  const corrected = await executeCommand(command);
  expect(corrected.success).toBe(true);
  expect(corrected.message).toContain("report consistency only");
});

test("skill audit rejects mixed modes and unexpected targets before reading files", async () => {
  const mixed = await executeCommand(parseCommand("/skill audit macro-regime-detector --record one --json two")!);
  expect(mixed.success).toBe(false);
  expect(mixed.message).toContain("--record PATH");
  const wrong = await executeCommand(parseCommand("/skill audit unknown --record one")!);
  expect(wrong.success).toBe(false);
  expect(wrong.message).toContain("macro-regime-detector");
});

test("human-readable acceptance fails when arithmetic is wrong even with matching source text", async () => {
  const files = reportFiles();
  writeFileSync(files.markdown, readFileSync(files.markdown, "utf8").replace("FMP API (0 calls)", "yfinance"));
  const report = JSON.parse(readFileSync(files.json, "utf8"));
  report.composite.component_scores.concentration.weighted_contribution = 99;
  writeFileSync(files.json, JSON.stringify(report));
  const result = await executeCommand(parseCommand(`/skill audit macro-regime-detector --json "${files.json}" --markdown "${files.markdown}"`)!);
  expect(result.success).toBe(false);
  expect(result.data).toMatchObject({ arithmeticPassed: false, humanReadablePassed: false, warnings: [],
    violations: ["invalid-component-concentration"] });
  expect((result.data as { summary?: unknown }).summary).toBeUndefined();
  expect(result.message).toContain("Human-readable report audit: failed");
});

test("skill audit rejects a false component dashboard without rejecting correct JSON arithmetic", async () => {
  const files = reportFiles();
  const markdown = readFileSync(files.markdown, "utf8")
    .replace("FMP API (0 calls)", "yfinance")
    .replace("**Yield Curve (10Y-2Y)** | 20% | ███░ 50", "**Yield Curve (10Y-2Y)** | 20% | ███░ 70");
  writeFileSync(files.markdown, markdown);
  const result = await executeCommand(parseCommand(`/skill audit macro-regime-detector --json "${files.json}" --markdown "${files.markdown}"`)!);
  expect(result.success).toBe(false);
  expect(result.data).toMatchObject({ arithmeticPassed: true, humanReadablePassed: false,
    warnings: ["markdown-component-dashboard-mismatch"] });
  expect(result.message).toContain("Markdown dashboard is not verified evidence");
});

test("one-shot macro audit is usable with broken settings and returns structured failure evidence", async () => {
  const files = reportFiles();
  writeFileSync(join(files.root, "settings.json"), "{broken settings");
  const command = `/skill audit macro-regime-detector --json "${files.json}" --markdown "${files.markdown}"`;
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", "--", "--json", "-c", command],
    { cwd: process.cwd(), env: { ...process.env, OHQUANT_DIR: files.root }, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(1);
  const envelope = JSON.parse(output);
  expect(envelope).toMatchObject({ ok: false, command: "skill", data: { scope: "report-only", source: "yfinance",
    arithmeticPassed: true, humanReadablePassed: false } });
  expect(output).not.toContain("settings_unavailable");
});

test("macro audit does not echo a private selected path on file failures", () => {
  const files = reportFiles();
  const privatePath = join(files.root, "PRIVATE_ACCOUNT_PATH_MARKER.json");
  const cases: Array<Record<string, string | number | boolean>> = [
    { json: privatePath, markdown: files.markdown }, { record: privatePath },
  ];
  for (const flags of cases) {
    const result = auditMacroCommand(flags);
    expect(result.success).toBe(false);
    expect(result.message).toContain("missing-file");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_ACCOUNT_PATH_MARKER");
  }
});

test("macro audit reports malformed JSON without copying its content", () => {
  const files = reportFiles();
  writeFileSync(files.json, '{"secret":"PRIVATE_PAYLOAD_MARKER",}');
  const result = auditMacroCommand({ json: files.json, markdown: files.markdown });
  expect(result.success).toBe(false);
  expect(result.message).toContain("invalid-json");
  expect(JSON.stringify(result)).not.toContain("PRIVATE_PAYLOAD_MARKER");
});

test("one-shot JSON audit keeps a missing private path out of the CLI envelope", async () => {
  const files = reportFiles();
  const missing = join(files.root, "PRIVATE_CLI_PATH_MARKER.json");
  const command = `/skill audit macro-regime-detector --record "${missing}"`;
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", "--", "--json", "-c", command],
    { cwd: process.cwd(), env: { ...process.env, OHQUANT_DIR: files.root }, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(1);
  expect(JSON.parse(output)).toMatchObject({ ok: false, command: "skill" });
  expect(output).not.toContain("PRIVATE_CLI_PATH_MARKER");
});

test("macro audit does not echo unverified JSON source or score fields", () => {
  const files = reportFiles();
  const report = JSON.parse(readFileSync(files.json, "utf8"));
  report.metadata.data_source = "PRIVATE_SOURCE_MARKER";
  report.metadata.data_mode = "PRIVATE_MODE_MARKER";
  report.composite.composite_score = "PRIVATE_SCORE_MARKER";
  writeFileSync(files.json, JSON.stringify(report));
  const result = auditMacroCommand({ json: files.json, markdown: files.markdown });
  expect(result.success).toBe(false);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  expect(result.data).toMatchObject({ source: null, dataMode: null, score: null });
});
