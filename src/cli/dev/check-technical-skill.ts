import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { executeCommand, parseCommand } from "../registry.ts";
import { CURATED_SKILL_REPOSITORIES } from "../../skill/catalog.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import type { CommandSkill } from "../../types/commands.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { output: { type: "string" } }, allowPositionals: false });
if (!values.output) throw new Error("Pass --output PATH for a new verification record.");
const output = resolve(values.output);
if (existsSync(output)) throw new Error("Verification output already exists.");
const repository = CURATED_SKILL_REPOSITORIES.find(entry => entry.repo === "tradermonty/claude-trading-skills")!;
const catalog = repository.skills.find(entry => entry.name === "technical-analyst")!;
const source = `https://raw.githubusercontent.com/${repository.repo}/${repository.revision}/skills/${catalog.name}`;
const root = mkdtempSync(join(tmpdir(), "whyj-technical-check-")), cwd = process.cwd();
const previousRoot = process.env.OHQUANT_DIR, previousSkills = process.env.OHQUANT_SKILLS_DIR;
try {
  process.env.OHQUANT_DIR = join(root, "preferences");
  process.env.OHQUANT_SKILLS_DIR = join(root, "skills");
  process.chdir(root);
  mkdirSync(join(root, ".git"));
  mkdirSync(process.env.OHQUANT_DIR, { recursive: true });
  writeFileSync(join(process.env.OHQUANT_DIR, "settings.json"), JSON.stringify(DEFAULT_SETTINGS));
  const skill = join(process.env.OHQUANT_SKILLS_DIR, repository.repo.replace("/", "-"), "skills", catalog.name);
  for (const name of Object.keys(catalog.reviewedFiles!)) {
    const response = await fetch(`${source}/${name}`, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Pinned source download failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 256 * 1024) throw new Error("Pinned source unexpectedly large.");
    mkdirSync(dirname(join(skill, name)), { recursive: true });
    writeFileSync(join(skill, name), bytes);
  }
  const checks: Array<{ scenario: string; success: boolean; readiness: CommandSkill["readiness"] }> = [];
  const helper = join(skill, "scripts/weekly_price_action.py"), original = readFileSync(helper);
  for (const scenario of ["reviewed", "modified", "missing"] as const) {
    if (scenario === "modified") writeFileSync(helper, Buffer.concat([original, Buffer.from("\n# local edit\n")]));
    if (scenario === "missing") rmSync(helper);
    const result = await executeCommand(parseCommand("/skill info technical-analyst --check-imports")!);
    const readiness = (result.data as CommandSkill | undefined)?.readiness;
    checks.push({ scenario, success: result.success, readiness });
    const mode = readiness?.modes.find(entry => entry.name === "contrarian confirmation script");
    const expected = { reviewed: "available", modified: "unverified", missing: "missing" }[scenario];
    if (!result.success || mode?.requirements.find(entry => entry.requirement === "reviewed-script-files")?.status !== expected
      || mode.requirements.find(entry => entry.requirement === "network:fmp-eod")?.status !== "unverified") {
      throw new Error(`Unexpected ${scenario} readiness result.`);
    }
  }
  const record = { checkedAt: new Date().toISOString(), bun: Bun.version, platform: process.platform, source,
    scope: "Production CLI handler, isolated settings and pinned public source files, real Python metadata/import check; no third-party script execution, FMP request, model or credentials.",
    reviewedFiles: catalog.reviewedFiles, checks };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(`Verified reviewed, modified and missing script diagnostics. Saved ${output}\n`);
} finally {
  process.chdir(cwd);
  if (previousRoot === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previousRoot;
  if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected technical verification root.");
  rmSync(root, { recursive: true, force: true });
}
