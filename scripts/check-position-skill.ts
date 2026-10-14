import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { CURATED_SKILL_REPOSITORIES } from "../src/skill/catalog.ts";
import { checkSkillFiles } from "../src/skill/file-probe.ts";
import { auditPositionCommand } from "../src/cli/handlers/skill-position-audit.ts";
import { runPython } from "../src/source/src/akshare-python.ts";

interface Scenario {
  name: string;
  args: string[];
  expected: Record<string, unknown>;
  bound?: boolean;
  violations?: string[];
}

// Expectations use small, independently calculable inputs, never the production auditor as an oracle.
const scenarios: Scenario[] = [
  { name: "fixed", args: ["--account-size", "100000", "--entry", "155", "--stop", "148.5", "--risk-pct", "1"],
    expected: { final_recommended_shares: 153, final_position_value: 23715, final_risk_dollars: 994.5, final_risk_pct: 0.99 } },
  { name: "position-cap", args: ["--account-size", "100000", "--entry", "155", "--stop", "148.5", "--risk-pct", "1", "--max-position-pct", "10"],
    expected: { final_recommended_shares: 64, final_position_value: 9920, final_risk_dollars: 416, final_risk_pct: 0.42, binding_constraint: "max_position_pct" } },
  { name: "fixed-half-cent", args: ["--account-size", "12.5", "--entry", "1", "--stop", "0.875", "--risk-pct", "1"],
    expected: { "calculations.fixed_fractional.dollar_risk": 0.12, final_recommended_shares: 1, final_risk_dollars: 0.12, final_risk_pct: 1 } },
  { name: "fixed-decimal-whole-boundary", args: ["--account-size", "700", "--entry", "100.8", "--stop", "100.1", "--risk-pct", "0.1"],
    expected: { final_recommended_shares: 1, final_position_value: 100.8, final_risk_dollars: 0.7, final_risk_pct: 0.1 } },
  { name: "fixed-below-decimal-boundary", args: ["--account-size", "699.99999999999", "--entry", "100.8", "--stop", "100.1", "--risk-pct", "0.1", "--fractional", "--share-precision", "8"],
    expected: { final_recommended_shares: 0.99999999, final_position_value: 100.8, final_risk_dollars: 0.7, final_risk_pct: 0.1 } },
  { name: "fixed-scientific-share", args: ["--account-size", "0.00001", "--entry", "100", "--stop", "90", "--risk-pct", "1", "--fractional", "--share-precision", "8"],
    expected: { final_recommended_shares: 1e-8, final_position_value: 0, final_risk_dollars: 0, final_risk_pct: 1 } },
  { name: "fixed-fractional", args: ["--account-size", "1150", "--entry", "100", "--stop", "90", "--risk-pct", "1", "--fractional", "--share-precision", "2"],
    expected: { final_recommended_shares: 1.15, final_position_value: 115, final_risk_dollars: 11.5, final_risk_pct: 1 } },
  { name: "atr", args: ["--account-size", "100000", "--entry", "155", "--atr", "3.2", "--atr-multiplier", "2", "--risk-pct", "1"],
    expected: { "parameters.stop_price": 148.6, final_recommended_shares: 156, final_position_value: 24180, final_risk_dollars: 998.4, final_risk_pct: 1 } },
  { name: "atr-sector-cap", args: ["--account-size", "100000", "--entry", "155", "--atr", "3.2", "--risk-pct", "1", "--max-sector-pct", "10", "--current-sector-exposure", "9"],
    expected: { final_recommended_shares: 6, final_position_value: 930, final_risk_dollars: 38.4, final_risk_pct: 0.04, binding_constraint: "max_sector_pct" } },
  { name: "tied-constraints", args: ["--account-size", "10000", "--entry", "100", "--stop", "90", "--risk-pct", "10", "--max-position-pct", "10", "--max-sector-pct", "20", "--current-sector-exposure", "10"],
    expected: { final_recommended_shares: 10, final_position_value: 1000, final_risk_dollars: 100, final_risk_pct: 1, binding_constraint: "max_sector_pct", "constraints_applied.0.binding": true, "constraints_applied.1.binding": true } },
  { name: "exhausted-sector", args: ["--account-size", "10000", "--entry", "100", "--stop", "90", "--risk-pct", "1", "--max-sector-pct", "20", "--current-sector-exposure", "25"],
    expected: { final_recommended_shares: 0, final_position_value: 0, final_risk_dollars: 0, final_risk_pct: 0, binding_constraint: "max_sector_pct" } },
  { name: "kelly-budget", args: ["--account-size", "100000", "--win-rate", "0.55", "--avg-win", "2.5", "--avg-loss", "1"],
    expected: { "calculations.kelly.kelly_pct": 37, "calculations.kelly.half_kelly_pct": 18.5, recommended_risk_budget: 18500 } },
  { name: "kelly-independent-rounding", args: ["--account-size", "1200", "--win-rate", "0.5", "--avg-win", "3", "--avg-loss", "1"],
    expected: { "calculations.kelly.kelly_pct": 33.33, "calculations.kelly.half_kelly_pct": 16.67, recommended_risk_budget: 200.04 } },
  { name: "kelly-half-cent-even-down", args: ["--account-size", "0.5", "--win-rate", "0.75", "--avg-win", "1", "--avg-loss", "1"],
    expected: { recommended_risk_budget: 0.12, recommended_risk_budget_pct: 25 } },
  { name: "kelly-half-cent-even-up", args: ["--account-size", "1.5", "--win-rate", "0.75", "--avg-win", "1", "--avg-loss", "1"],
    expected: { recommended_risk_budget: 0.38, recommended_risk_budget_pct: 25 } },
  { name: "kelly-no-positive-budget", args: ["--account-size", "1000", "--win-rate", "0.2", "--avg-win", "1", "--avg-loss", "1"],
    expected: { recommended_risk_budget: 0, recommended_risk_budget_pct: 0 } },
  { name: "kelly-shares-stop", args: ["--account-size", "100000", "--entry", "155", "--stop", "148.5", "--win-rate", "0.55", "--avg-win", "2.5", "--avg-loss", "1"], bound: false,
    expected: { final_recommended_shares: 2846, final_position_value: 441130, final_risk_dollars: 18499, final_risk_pct: 18.5 } },
  { name: "kelly-shares-independent-rounding", args: ["--account-size", "1200", "--entry", "2", "--stop", "1", "--win-rate", "0.5", "--avg-win", "3", "--avg-loss", "1"], bound: false,
    expected: { final_recommended_shares: 200, final_position_value: 400, final_risk_dollars: 200, final_risk_pct: 16.67 } },
  { name: "kelly-shares-no-stop", args: ["--account-size", "100000", "--entry", "100", "--win-rate", "0.55", "--avg-win", "2.5", "--avg-loss", "1"], bound: false,
    expected: { final_recommended_shares: 185, final_position_value: 18500, final_risk_dollars: null, final_risk_pct: null } },
  { name: "kelly-shares-fractional", args: ["--account-size", "1150", "--entry", "100", "--stop", "90", "--win-rate", "0.55", "--avg-win", "2.5", "--avg-loss", "1", "--fractional", "--share-precision", "2"], bound: false,
    expected: { final_recommended_shares: 21.27, final_position_value: 2127, final_risk_dollars: 212.7, final_risk_pct: 18.5 } },
  { name: "atr-explicit-stop-conflict", args: ["--account-size", "100000", "--entry", "155", "--stop", "150", "--atr", "3.2", "--risk-pct", "1"], bound: false, violations: ["wrong-final-risk"],
    expected: { "parameters.stop_price": 148.6, final_recommended_shares: 156, final_risk_dollars: 780, final_risk_pct: 0.78 } },
  { name: "zero-stop-omitted-risk", args: ["--account-size", "100", "--entry", "1", "--stop", "0", "--risk-pct", "1"], bound: false, violations: ["wrong-final-risk"],
    expected: { "parameters.stop_price": 0, final_recommended_shares: 1, final_risk_dollars: null, final_risk_pct: null } },
];

const { values } = parseArgs({ args: process.argv.slice(2), options: { output: { type: "string" }, "source-git": { type: "string" } }, allowPositionals: false });
if (!values.output) throw new Error("Pass --output PATH for a new synthetic verification record.");
const output = resolve(values.output), bundle = `${output}.bundle`;
if (existsSync(output) || existsSync(bundle)) throw new Error("Verification record or bundle already exists.");
const repository = CURATED_SKILL_REPOSITORIES.find(entry => entry.repo === "tradermonty/claude-trading-skills")!;
const catalog = repository.skills.find(entry => entry.name === "position-sizer")!;
const sourceGit = values["source-git"] ? resolve(values["source-git"]) : undefined;
const root = mkdtempSync(join(tmpdir(), "whyj-position-verify-"));
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
try {
  const sourceFiles: Array<{ path: string; sha256: string; bytes: number }> = [];
  for (const [name, expected] of Object.entries(catalog.reviewedFiles!)) {
    const path = `skills/${catalog.name}/${name}`;
    let bytes: Buffer;
    if (sourceGit) bytes = execFileSync("git", ["-C", sourceGit, "show", `${repository.revision}:${path}`], { timeout: 10_000, maxBuffer: 256 * 1024, windowsHide: true });
    else {
      const response = await fetch(`https://raw.githubusercontent.com/${repository.repo}/${repository.revision}/${path}`, { redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`Pinned source download failed: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (bytes.length > 256 * 1024 || hash(bytes.toString("utf8").replace(/\r\n/g, "\n")) !== expected) throw new Error(`Pinned source mismatch: ${name}`);
    sourceFiles.push({ path, sha256: hash(bytes), bytes: bytes.length });
    mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), bytes);
  }
  const files = checkSkillFiles(root, join(root, "SKILL.md"), catalog.reviewedFiles!);
  if (files.status !== "available") throw new Error("Production file audit did not accept the fixed closure.");
  const runner = "import os, runpy, sys\nos.chdir(sys.argv[1])\nsys.argv = sys.argv[2:]\nsys.path.insert(0, os.path.dirname(sys.argv[0]))\nrunpy.run_path(sys.argv[0], run_name='__main__')";
  const python = await runPython("import json, platform, sys\nprint(json.dumps({'version': platform.python_version(), 'executable': sys.executable}))", [], { timeoutMs: 10_000 });
  const results = [];
  const archives: Array<{ path: string; bytes: Buffer }> = [];
  for (const scenario of scenarios) {
    const directory = join(root, "synthetic", scenario.name), script = join(root, "scripts/position_sizer.py");
    const run = await runPython(runner, [root, script, ...scenario.args, "--output-dir", directory], { timeoutMs: 30_000 });
    if (run.stderr.trim()) throw new Error(`Unexpected Python stderr: ${scenario.name}`);
    const names = readdirSync(directory), json = names.find(name => name.endsWith(".json")), markdown = names.find(name => name.endsWith(".md"));
    if (names.length !== 2 || !json || !markdown) throw new Error(`Unexpected report closure: ${scenario.name}`);
    const jsonBytes = readFileSync(join(directory, json)), markdownBytes = readFileSync(join(directory, markdown));
    const raw: unknown = JSON.parse(jsonBytes.toString("utf8"));
    for (const [path, expected] of Object.entries(scenario.expected)) {
      let actual: unknown = raw;
      for (const part of path.split(".")) actual = actual !== null && typeof actual === "object" ? Reflect.get(actual, part) : undefined;
      if (actual !== expected) throw new Error(`Independent expectation failed: ${scenario.name}/${path}`);
    }
    const audit = auditPositionCommand({ json: join(directory, json), markdown: join(directory, markdown) });
    const expectedViolations = scenario.violations ?? [], bound = scenario.bound ?? true;
    const expectedAudit = { scope: "private-position-report", arithmeticPassed: expectedViolations.length === 0, inputBindingPassed: bound,
      humanReadablePassed: true, violations: expectedViolations, presentationIssues: [] };
    if (audit.success !== (bound && expectedViolations.length === 0) || !Bun.deepEquals(audit.data, expectedAudit)) throw new Error(`Unexpected production verdict: ${scenario.name}`);
    // Keep only synthetic reports; no account/private file is an input to this verifier.
    const reportJson = `${scenario.name}.json`, reportMarkdown = `${scenario.name}.md`;
    archives.push({ path: reportJson, bytes: jsonBytes }, { path: reportMarkdown, bytes: markdownBytes });
    results.push({ ...scenario, passed: true, audit: expectedAudit, commandSuccess: audit.success,
      reports: [{ path: reportJson, sha256: hash(jsonBytes) }, { path: reportMarkdown, sha256: hash(markdownBytes) }] });
  }
  const record = { version: 1, kind: "curated-position-synthetic-verification", checkedAt: new Date().toISOString(), bun: Bun.version, platform: process.platform,
    source: { repository: repository.repo, revision: repository.revision, transport: sourceGit ? "read-only-local-git-objects" : "github-raw", files: sourceFiles },
    python: JSON.parse(python.stdout), fileAudit: files, scenarios: results, passed: true, bundle: `${output.split(/[\\/]/).at(-1)}.bundle`,
    boundary: "Explicitly executes reviewed fixed upstream CLI on synthetic inputs in TEMP, then production local report audit and hand-derived expectations. No real account, model, market network, installer or user checkout change. Kelly-share reports remain input-unbound; ATR/explicit-stop conflict and zero-stop risk omission are expected upstream failures. File matching and this matrix do not authorize Agent execution or validate every input or strategy." };
  mkdirSync(dirname(output), { recursive: true }); mkdirSync(bundle);
  for (const archive of archives) writeFileSync(join(bundle, archive.path), archive.bytes, { flag: "wx" });
  writeFileSync(output, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(`Verified ${results.length} synthetic position scenarios. Saved ${output}\n`);
} finally {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected synthetic position root.");
  rmSync(root, { recursive: true, force: true });
}
