import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { resolveOhquantDir, resolveSkillsDir } from "../storage/index.ts";

export const SKILLS_DIR = resolveSkillsDir();
const skillsDir = () => resolveSkillsDir();

const DEFAULT_REPOS = [
  "LLMQuant/skills",
  "tradermonty/claude-trading-skills",
];

const DEFAULT_REPO_DIRS = new Set(DEFAULT_REPOS.map((repo) => repo.replace("/", "-")));

export const CORE_SKILL_NAMES = [
  "llmquant-data",
  "llmquant-macro",
  "llmquant-equities",
  "llmquant-portfolio",
  "llmquant-risk",
  "market-breadth-analyzer",
  "technical-analyst",
  "position-sizer",
  "macro-regime-detector",
  "market-environment-analysis",
];

export function skillPaths(): string[] {
  if (!existsSync(skillsDir())) return [];
  const paths: string[] = [];
  for (const entry of readdirSync(skillsDir(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (DEFAULT_REPO_DIRS.has(entry.name)) {
      const repoPath = join(skillsDir(), entry.name);
      const nestedSkills = join(repoPath, "skills");
      for (const skillName of CORE_SKILL_NAMES) {
        const skillPath = join(nestedSkills, skillName);
        if (existsSync(skillPath)) paths.push(skillPath);
      }
      continue;
    }
    const repoPath = join(skillsDir(), entry.name);
    const nestedSkills = join(repoPath, "skills");
    paths.push(existsSync(nestedSkills) ? nestedSkills : repoPath);
  }
  return paths;
}

export function installSkills(repo: string): { success: boolean; message: string } {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return {
      success: false,
      message: "Use a GitHub repo in owner/repo format, for example: /skill install LLMQuant/skills",
    };
  }
  const target = join(skillsDir(), repo.replace("/", "-"));
  const url = `https://github.com/${repo}.git`;

  if (existsSync(target)) {
    try {
      execFileSync("git", ["-C", target, "pull", "--ff-only"], { stdio: "pipe", timeout: 30_000 });
      return { success: true, message: `Updated ${repo}\nLocation  ${target}\nNext      Run /skill to see available skills.` };
    } catch {
      rmSync(target, { recursive: true, force: true });
    }
  }

  mkdirSync(skillsDir(), { recursive: true });
  try {
    execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", url, target], { stdio: "pipe", timeout: 60_000 });
    return { success: true, message: `Installed ${repo}\nLocation  ${target}\nNext      Run /skill to see new skills.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Could not install ${repo}.\nCause: ${msg}\nNext: Check network/proxy access to GitHub, then retry /skill install ${repo}.`,
    };
  }
}

/** Install default skill repos on first run (idempotent). */
export function ensureDefaultSkills(): void {
  mkdirSync(resolveOhquantDir(), { recursive: true });
  mkdirSync(skillsDir(), { recursive: true });

  for (const repo of DEFAULT_REPOS) {
    const target = join(skillsDir(), repo.replace("/", "-"));
    if (existsSync(target)) continue;

    const url = `https://github.com/${repo}.git`;
    try {
      execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", url, target], { stdio: "pipe", timeout: 60_000 });
    } catch { /* silent */ }
  }
}
