import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { executeCommand, parseCommand } from "../src/cli/registry.ts";
import { DEFAULT_SETTINGS } from "../src/types/config.ts";
import type { CommandSkill } from "../src/types/commands.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { output: { type: "string" } }, allowPositionals: false });
if (!values.output) throw new Error("Pass --output PATH for a new verification record.");
const output = resolve(values.output);
if (existsSync(output)) throw new Error("Verification output already exists.");
const root = mkdtempSync(join(tmpdir(), "whyj-network-check-")), cwd = process.cwd();
const previousRoot = process.env.OHQUANT_DIR, previousSkills = process.env.OHQUANT_SKILLS_DIR;
try {
  process.env.OHQUANT_DIR = join(root, "preferences");
  process.env.OHQUANT_SKILLS_DIR = join(root, "skills");
  process.chdir(root);
  mkdirSync(join(root, ".git"));
  mkdirSync(process.env.OHQUANT_DIR, { recursive: true });
  writeFileSync(join(process.env.OHQUANT_DIR, "settings.json"), JSON.stringify(DEFAULT_SETTINGS));
  const skill = join(process.env.OHQUANT_SKILLS_DIR, "tradermonty-claude-trading-skills", "skills", "market-breadth-analyzer");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: market-breadth-analyzer\ndescription: Isolated network verification fixture\n---\nFixture only.\n");
  const result = await executeCommand(parseCommand("/skill info market-breadth-analyzer --check --check-network")!);
  const readiness = (result.data as CommandSkill | undefined)?.readiness;
  const record = { checkedAt: new Date().toISOString(), bun: Bun.version, platform: process.platform,
    scope: "Production CLI handler, isolated skill/settings fixture, real selected Python and fixed public CSV endpoints. No model, account or third-party skill script execution.",
    commandSuccess: result.success, readiness };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(record) + "\n");
  if (!result.success || readiness?.status !== "requirements-met") process.exitCode = 1;
} finally {
  process.chdir(cwd);
  if (previousRoot === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previousRoot;
  if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected network verification root.");
  rmSync(root, { recursive: true, force: true });
}
