import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { executeCommand, parseCommand } from "../src/cli/registry.ts";
import { CURATED_SKILL_REPOSITORIES } from "../src/skill/catalog.ts";
import { BREADTH_NETWORK_SCRIPT } from "../src/skill/breadth-network-script.ts";
import { auditBreadthReport } from "../src/skill/breadth-report-audit.ts";
import { readSkillPython } from "../src/skill/python-probe.ts";
import { DEFAULT_SETTINGS } from "../src/types/config.ts";
import type { CommandSkill } from "../src/types/commands.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { output: { type: "string" } }, allowPositionals: false });
if (!values.output) throw new Error("Pass --output PATH for a new verification record.");
const output = resolve(values.output);
if (existsSync(output)) throw new Error("Verification output already exists.");
const bundleDir = `${output}.bundle`;
if (existsSync(bundleDir)) throw new Error("Verification bundle already exists.");
const repository = CURATED_SKILL_REPOSITORIES.find(item => item.repo === "tradermonty/claude-trading-skills")!;
const catalog = repository.skills.find(item => item.name === "market-breadth-analyzer")!;
const source = `https://raw.githubusercontent.com/${repository.repo}/${repository.revision}/skills/${catalog.name}`;
const dataRoot = "https://tradermonty.github.io/market-breadth-analysis";
const urls = { detail: `${dataRoot}/market_breadth_data.csv`, summary: `${dataRoot}/market_breadth_summary.csv` };
const root = mkdtempSync(join(tmpdir(), "whyj-breadth-check-")), cwd = process.cwd();
const previousRoot = process.env.OHQUANT_DIR, previousSkills = process.env.OHQUANT_SKILLS_DIR;
let server: ReturnType<typeof Bun.serve> | undefined;
let stopChild: (() => void) | undefined;

function hash(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }
async function publicCsv(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body) throw new Error(`Public CSV request failed: HTTP ${response.status}`);
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4 * 1024 * 1024) throw new Error("Public CSV response exceeded 4 MiB.");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error("Public CSV response was empty.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function pythonProcess(python: string, args: string[], timeoutMs: number, env: Record<string, string>) {
  const child = Bun.spawn([python, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  stopChild = () => child.kill();
  const stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text();
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    const exitCode = await child.exited;
    return { exitCode, stdout: await stdout, stderr: await stderr };
  } finally { clearTimeout(timer); stopChild = undefined; }
}

try {
  process.env.OHQUANT_DIR = join(root, "preferences");
  process.env.OHQUANT_SKILLS_DIR = join(root, "skills");
  process.chdir(root);
  mkdirSync(join(root, ".git"));
  mkdirSync(process.env.OHQUANT_DIR, { recursive: true });
  writeFileSync(join(process.env.OHQUANT_DIR, "settings.json"), JSON.stringify(DEFAULT_SETTINGS));
  const skill = join(process.env.OHQUANT_SKILLS_DIR, repository.repo.replace("/", "-"), "skills", catalog.name);
  const names = Object.keys(catalog.reviewedFiles!);
  for (let start = 0; start < names.length; start += 4) {
    const group = names.slice(start, start + 4);
    const results = await Promise.allSettled(group.map(async name => {
      const response = await fetch(`${source}/${name}`, { redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 256 * 1024 || hash(new TextDecoder().decode(bytes).replace(/\r\n/g, "\n")) !== catalog.reviewedFiles![name])
        throw new Error("Downloaded source does not match the curated manifest.");
      return bytes;
    }));
    for (const [index, result] of results.entries()) {
      if (result.status !== "fulfilled") throw new Error(`Pinned breadth download failed for ${group[index]}: ${result.reason instanceof Error ? result.reason.message : "unknown"}`);
      const target = join(skill, group[index]!);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, result.value, { flag: "wx" });
    }
  }
  const command = await executeCommand(parseCommand("/skill info market-breadth-analyzer --check --check-network")!);
  const readiness = (command.data as CommandSkill | undefined)?.readiness;
  if (!command.success || readiness?.status !== "requirements-met"
    || readiness.modes[0]?.requirements.find(item => item.requirement === "reviewed-script-files")?.status !== "available"
    || readiness.modes[0]?.requirements.find(item => item.requirement === "network:tradermonty-breadth-csv")?.status !== "available")
    throw new Error("Production breadth readiness did not verify the pinned files, Python and public CSV input.");
  const python = readSkillPython(root)?.executable;
  if (!python) throw new Error("Production check did not establish a Python executable.");
  const [detail, summary] = await Promise.all([publicCsv(urls.detail), publicCsv(urls.summary)]);
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/detail.csv") return new Response(detail, { headers: { "content-type": "text/csv" } });
    if (path === "/summary.csv") return new Response(summary, { headers: { "content-type": "text/csv" } });
    return new Response("missing", { status: 404 });
  } });
  const local = { detail: `${server.url}detail.csv`, summary: `${server.url}summary.csv` };
  const appdata = join(root, "appdata"), reports = join(root, "reports");
  mkdirSync(appdata); mkdirSync(reports);
  const env: Record<string, string> = { APPDATA: appdata, LOCALAPPDATA: appdata, XDG_CACHE_HOME: appdata,
    PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1", PYTHONUTF8: "1", NO_PROXY: "127.0.0.1,localhost" };
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"] as const)
    if (process.env[name]) env[name] = process.env[name]!;
  const probe = await pythonProcess(python, ["-c", BREADTH_NETWORK_SCRIPT, local.detail, local.summary, new Date().toISOString().slice(0, 10)], 20_000, env);
  const observation = probe.exitCode === 0 ? JSON.parse(probe.stdout) as Record<string, unknown> : null;
  if (!observation || observation.ok !== true || observation.executable !== python || !Number.isSafeInteger(observation.detailRows)
    || typeof observation.latestDate !== "string" || !Number.isSafeInteger(observation.summaryRows))
    throw new Error("Captured public CSV bytes failed the same bounded input probe.");
  const run = await pythonProcess(python, [join(skill, "scripts/market_breadth_analyzer.py"),
    "--detail-url", local.detail, "--summary-url", local.summary, "--output-dir", reports], 60_000, env);
  if (run.exitCode !== 0) throw new Error("Pinned public breadth script did not complete.");
  const files = readdirSync(reports), json = files.filter(name => /^market_breadth_\d{4}-\d{2}-\d{2}_\d{6}\.json$/.test(name));
  const markdown = files.filter(name => /^market_breadth_\d{4}-\d{2}-\d{2}_\d{6}\.md$/.test(name));
  if (json.length !== 1 || markdown.length !== 1 || !files.includes("market_breadth_history.json"))
    throw new Error("Pinned script did not produce exactly one report pair and a history file.");
  const reportBytes = readFileSync(join(reports, json[0]!)), markdownBytes = readFileSync(join(reports, markdown[0]!));
  const historyBytes = readFileSync(join(reports, "market_breadth_history.json"));
  const report: unknown = JSON.parse(reportBytes.toString("utf8"));
  const issues = auditBreadthReport(report, { detailRows: Number(observation.detailRows), latestDate: String(observation.latestDate) });
  if (issues.length) throw new Error(`Breadth report receipt failed: ${issues.join(", ")}`);
  const score = (report as { composite: { composite_score: number; zone: string } }).composite;
  const markdownText = markdownBytes.toString("utf8");
  if (!markdownText.includes(`**${score.composite_score}/100**`) || !markdownText.includes(score.zone)
    || !markdownText.includes(String(observation.latestDate))) throw new Error("Markdown and JSON report receipts disagree.");
  const record = { checkedAt: new Date().toISOString(), bun: Bun.version, platform: process.platform,
    curatedRevision: repository.revision, manifestFiles: names.length, readiness,
    scope: "Pinned public breadth import closure; production CLI dependency check; public CSV captured once and served to the script from isolated localhost; real Python execution; no account/model input.",
    input: { detail: { url: urls.detail, sha256: hash(detail), bytes: detail.length, rows: observation.detailRows,
        archive: relative(dirname(output), join(bundleDir, "detail.csv")) },
      summary: { url: urls.summary, sha256: hash(summary), bytes: summary.length, rows: observation.summaryRows,
        archive: relative(dirname(output), join(bundleDir, "summary.csv")) },
      latestDate: observation.latestDate },
    output: { reportJson: json[0], reportSha256: hash(reportBytes), reportArchive: relative(dirname(output), join(bundleDir, "report.json")),
      reportMarkdown: markdown[0], markdownSha256: hash(markdownBytes), markdownArchive: relative(dirname(output), join(bundleDir, "report.md")),
      historySha256: hash(historyBytes), historyArchive: relative(dirname(output), join(bundleDir, "history.json")), score: score.composite_score, zone: score.zone,
      independentAuditIssues: issues },
    scriptReport: report };
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(bundleDir);
  writeFileSync(join(bundleDir, "detail.csv"), detail, { flag: "wx" });
  writeFileSync(join(bundleDir, "summary.csv"), summary, { flag: "wx" });
  writeFileSync(join(bundleDir, "report.json"), reportBytes, { flag: "wx" });
  writeFileSync(join(bundleDir, "report.md"), markdownBytes, { flag: "wx" });
  writeFileSync(join(bundleDir, "history.json"), historyBytes, { flag: "wx" });
  writeFileSync(output, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(`Pinned breadth script verified on captured public CSV; ${score.composite_score}/100, ${score.zone}. Saved ${output}\n`);
} finally {
  stopChild?.(); server?.stop(true);
  process.chdir(cwd);
  if (previousRoot === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previousRoot;
  if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected breadth verification root.");
  rmSync(root, { recursive: true, force: true });
}
