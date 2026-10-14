import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { executeCommand, parseCommand } from "../src/cli/registry.ts";
import { CURATED_SKILL_REPOSITORIES } from "../src/skill/catalog.ts";
import { DEFAULT_SETTINGS } from "../src/types/config.ts";
import type { CommandSkill } from "../src/types/commands.ts";
import { readSkillPython } from "../src/skill/python-probe.ts";
import { auditMacroPresentation, auditMacroReport } from "../src/skill/macro-report-audit.ts";
import { auditMacroReportFromInputs, MACRO_ETFS, parseMacroInput, type MacroEtf, type MacroPriceBar } from "../src/skill/macro-input-audit.ts";
import { auditMacroScoresFromInputs } from "../src/skill/macro-score-audit.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { output: { type: "string" }, network: { type: "boolean" }, "run-public-script": { type: "boolean" }, "capture-inputs": { type: "boolean" } }, allowPositionals: false });
if (!values.output) throw new Error("Pass --output PATH for a new verification record.");
if (values["run-public-script"] && !values.network) throw new Error("--run-public-script also requires --network.");
if (values["capture-inputs"] && !values["run-public-script"]) throw new Error("--capture-inputs also requires --run-public-script.");
const output = resolve(values.output);
if (existsSync(output)) throw new Error("Verification output already exists.");
if (existsSync(`${output}.bundle`)) throw new Error("Verification bundle already exists.");
const repository = CURATED_SKILL_REPOSITORIES.find(entry => entry.repo === "tradermonty/claude-trading-skills")!;
const catalog = repository.skills.find(entry => entry.name === "macro-regime-detector")!;
const source = `https://raw.githubusercontent.com/${repository.repo}/${repository.revision}/skills/${catalog.name}`;
const root = mkdtempSync(join(tmpdir(), "whyj-macro-check-")), cwd = process.cwd();
const previousRoot = process.env.OHQUANT_DIR, previousSkills = process.env.OHQUANT_SKILLS_DIR;
try {
  process.env.OHQUANT_DIR = join(root, "preferences");
  process.env.OHQUANT_SKILLS_DIR = join(root, "skills");
  process.chdir(root);
  mkdirSync(join(root, ".git"));
  mkdirSync(process.env.OHQUANT_DIR, { recursive: true });
  writeFileSync(join(process.env.OHQUANT_DIR, "settings.json"), JSON.stringify(DEFAULT_SETTINGS));
  const skill = join(process.env.OHQUANT_SKILLS_DIR, repository.repo.replace("/", "-"), "skills", catalog.name);
  const names = Object.keys(catalog.reviewedFiles!);
  for (let offset = 0; offset < names.length; offset += 4) {
    const group = names.slice(offset, offset + 4);
    const downloads = await Promise.allSettled(group.map(async name => {
      const response = await fetch(`${source}/${name}`, { redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`Pinned source download failed: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 256 * 1024) throw new Error("Pinned source unexpectedly large.");
      return bytes;
    }));
    for (const [index, item] of downloads.entries()) {
      if (item?.status !== "fulfilled") throw new Error(`Pinned source download failed for ${group[index]}: ${item?.reason instanceof Error ? item.reason.message : "unknown error"}`);
      const target = join(skill, group[index]!);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, item.value);
    }
  }
  const checks: Array<{ scenario: string; success: boolean; readiness: CommandSkill["readiness"] }> = [];
  let publicScript: { exitCode: number; reportJson?: string; reportMarkdown?: string; dataMode?: string; etfsAnalyzed?: number;
    treasuryDataAvailable?: boolean; componentCount?: number; finiteComposite?: boolean; etfBars?: Record<string, number>; failedEtfs?: string[];
    reportArchive?: string; reportSha256?: string; reportBytes?: number; markdownArchive?: string; markdownSha256?: string;
    markdownBytes?: number; arithmeticAudit?: string[]; presentationAudit?: string[]; presentationAuditVersion?: number;
    inputArchives?: Record<string, { archive: string; sha256: string; bytes: number; rows: number; oldestDate: string; latestDate: string }>;
    inputAudit?: string[]; scoreAudit?: string[] } | undefined;
  let publicReport: { json: Buffer; markdown: Buffer } | undefined;
  let publicInputs: Partial<Record<MacroEtf, Buffer>> | undefined;
  const helper = join(skill, "scripts/calculators/utils.py"), original = readFileSync(helper);
  for (const scenario of ["reviewed", "modified", "missing"] as const) {
    if (scenario === "modified") writeFileSync(helper, Buffer.concat([original, Buffer.from("\n# local edit\n")]));
    if (scenario === "missing") rmSync(helper);
    const command = scenario === "reviewed" && values.network
      ? "/skill info macro-regime-detector --check-imports --check-network"
      : "/skill info macro-regime-detector --check-imports";
    const result = await executeCommand(parseCommand(command)!);
    const readiness = (result.data as CommandSkill | undefined)?.readiness;
    checks.push({ scenario, success: result.success, readiness });
    const mode = readiness?.modes.find(entry => entry.name === "cross-asset data");
    const expected = { reviewed: "available", modified: "unverified", missing: "missing" }[scenario];
    if (!result.success || mode?.requirements.find(entry => entry.requirement === "reviewed-script-files")?.status !== expected
      || mode.requirements.find(entry => entry.requirement === "network:etf-history")?.status === "available" && !values.network) {
      throw new Error(`Unexpected ${scenario} readiness result.`);
    }
    if (scenario === "reviewed" && values["run-public-script"]) {
      if (readiness?.status !== "requirements-met") throw new Error("Public script execution needs matching local and ETF input checks.");
      const python = readSkillPython(root)?.executable;
      if (!python) throw new Error("Python executable was not established.");
      const reports = join(root, "reports");
      mkdirSync(reports);
      const inputs = join(root, "inputs");
      if (values["capture-inputs"]) mkdirSync(inputs);
      const environment: Record<string, string> = { FMP_API_KEY: "", APPDATA: join(root, "appdata"),
        LOCALAPPDATA: join(root, "appdata"), XDG_CACHE_HOME: join(root, "appdata"),
        PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1", PYTHONUTF8: "1" };
      for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HTTP_PROXY", "HTTPS_PROXY"] as const) {
        if (process.env[name]) environment[name] = process.env[name]!;
      }
      mkdirSync(environment.APPDATA, { recursive: true });
      const pinnedEntry = join(skill, "scripts/macro_regime_detector.py");
      const args = values["capture-inputs"]
        ? [python, join(cwd, "scripts/capture-macro-inputs.py"), pinnedEntry, inputs, reports]
        : [python, pinnedEntry, "--output-dir", reports];
      const child = Bun.spawn(args,
        { cwd: root, env: environment, stdout: "pipe", stderr: "ignore" });
      const timer = setTimeout(() => child.kill(), 120_000);
      let exitCode: number;
      const outputText = new Response(child.stdout).text();
      try { exitCode = await child.exited; } finally { clearTimeout(timer); }
      const transcript = await outputText, etfBars: Record<string, number> = {}, failedEtfs: string[] = [];
      for (const match of transcript.matchAll(/Fetching (RSP|SPY|IWM|TLT|SHY|HYG|LQD|XLY|XLP) \(\d+ days\)\.\.\. (OK \((\d+) bars\)|FAILED)/g)) {
        if (match[3]) etfBars[match[1]!] = Number(match[3]); else failedEtfs.push(match[1]!);
      }
      publicScript = { exitCode, etfBars, failedEtfs };
      if (exitCode === 0) {
        if (Object.keys(etfBars).length !== 9 || failedEtfs.length || Object.values(etfBars).some(bars => bars < 400)) {
          throw new Error("Public macro script did not obtain all nine ETF histories.");
        }
        const files = readdirSync(reports), json = files.filter(name => /^macro_regime_.*\.json$/.test(name)), markdown = files.filter(name => /^macro_regime_.*\.md$/.test(name));
        if (json.length !== 1 || markdown.length !== 1) throw new Error("Unexpected public macro report files.");
        const reportBytes = readFileSync(join(reports, json[0]!)), markdownBytes = readFileSync(join(reports, markdown[0]!));
        if (reportBytes.length > 256 * 1024 || markdownBytes.length > 256 * 1024)
          throw new Error("Public macro report exceeds the bounded verification bundle.");
        const report = JSON.parse(reportBytes.toString("utf8")) as Record<string, unknown>;
        const metadata = report.metadata as Record<string, unknown> | undefined;
        const composite = report.composite as Record<string, unknown> | undefined;
        const components = report.components as Record<string, unknown> | undefined;
        if (!metadata || metadata.data_mode !== "yfinance_only" || metadata.data_source !== "yfinance"
          || !Array.isArray(metadata.etfs_analyzed) || metadata.etfs_analyzed.length !== 9
          || !components || Object.keys(components).length !== 6 || !composite || !Number.isFinite(composite.composite_score)) {
          throw new Error("Public macro report contract was incomplete.");
        }
        const issues = auditMacroReport(report);
        if (issues.length) throw new Error(`Public macro report arithmetic audit failed: ${issues.join(", ")}`);
        publicReport = { json: reportBytes, markdown: markdownBytes };
        const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
        const bundleName = `${basename(output)}.bundle`;
        let inputArchives: Record<string, { archive: string; sha256: string; bytes: number; rows: number;
          oldestDate: string; latestDate: string }> | undefined;
        let inputAudit: string[] | undefined, scoreAudit: string[] | undefined;
        if (values["capture-inputs"]) {
          const captured: Partial<Record<MacroEtf, MacroPriceBar[]>> = {}, archives: Record<string, { archive: string; sha256: string;
            bytes: number; rows: number; oldestDate: string; latestDate: string }> = {};
          publicInputs = {};
          for (const symbol of MACRO_ETFS) {
            const bytes = readFileSync(join(inputs, `${symbol}.json`));
            const { bars, receipt } = parseMacroInput(JSON.parse(bytes.toString("utf8")), symbol);
            if (receipt.rows !== etfBars[symbol]) throw new Error(`Captured ${symbol} rows differ from pinned script output.`);
            captured[symbol] = bars; publicInputs[symbol] = bytes;
            archives[symbol] = { archive: `${bundleName}/inputs/${symbol}.json`, sha256: digest(bytes), bytes: bytes.length, ...receipt };
          }
          const capturedInputs = captured as Record<MacroEtf, MacroPriceBar[]>;
          inputAudit = auditMacroReportFromInputs(report, capturedInputs);
          if (inputAudit.length) throw new Error(`Public macro input reconciliation failed: ${inputAudit.join(", ")}`);
          scoreAudit = auditMacroScoresFromInputs(report, capturedInputs);
          if (scoreAudit.length) throw new Error(`Public macro transition score audit failed: ${scoreAudit.join(", ")}`);
          inputArchives = archives;
        }
        publicScript = { exitCode, reportJson: json[0], reportMarkdown: markdown[0], dataMode: metadata.data_mode,
          etfsAnalyzed: metadata.etfs_analyzed.length, treasuryDataAvailable: metadata.treasury_data_available === true,
          componentCount: Object.keys(components).length, finiteComposite: true, etfBars, failedEtfs,
          reportArchive: `${bundleName}/report.json`, reportSha256: digest(reportBytes), reportBytes: reportBytes.length,
          markdownArchive: `${bundleName}/report.md`, markdownSha256: digest(markdownBytes), markdownBytes: markdownBytes.length,
          arithmeticAudit: issues, presentationAuditVersion: 2,
          presentationAudit: auditMacroPresentation(report, markdownBytes.toString("utf8")),
          ...(inputArchives ? { inputArchives, inputAudit, scoreAudit } : {}) };
      }
    }
  }
  const record = { checkedAt: new Date().toISOString(), bun: Bun.version, platform: process.platform, source,
    scope: `Production CLI handler, isolated settings, all ${names.length} pinned public files, real Python metadata/import check${values.network ? ", public ETF probe" : ""}${values["run-public-script"] ? ", pinned public yfinance-only script in isolated directory" : ""}${values["capture-inputs"] ? ", instrumented price-client input capture" : ""}; no FMP request or model/account credentials.`,
    reviewedFiles: catalog.reviewedFiles, checks, ...(publicScript ? { publicScript } : {}) };
  mkdirSync(dirname(output), { recursive: true });
  if (publicReport) {
    const bundle = `${output}.bundle`;
    mkdirSync(bundle);
    writeFileSync(join(bundle, "report.json"), publicReport.json, { flag: "wx" });
    writeFileSync(join(bundle, "report.md"), publicReport.markdown, { flag: "wx" });
    if (publicInputs) {
      const inputBundle = join(bundle, "inputs");
      mkdirSync(inputBundle);
      for (const symbol of MACRO_ETFS) writeFileSync(join(inputBundle, `${symbol}.json`), publicInputs[symbol]!, { flag: "wx" });
    }
  }
  writeFileSync(output, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(`Verified reviewed, modified and missing macro script diagnostics. Saved ${output}\n`);
  if (values["run-public-script"] && publicScript?.exitCode !== 0) {
    process.stderr.write("Pinned public macro script did not complete; inspect the aggregate verification record.\n");
    process.exitCode = 1;
  }
} finally {
  process.chdir(cwd);
  if (previousRoot === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previousRoot;
  if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected macro verification root.");
  rmSync(root, { recursive: true, force: true });
}
