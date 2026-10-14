import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveSkillsDir } from "../../storage/index.ts";
import { installSkillRepository, type SkillGit, type SkillInstallResult } from "../../skill/index.ts";
import { CURATED_SKILL_REPOSITORIES, curatedSkillRepository } from "../../skill/index.ts";
import { invalidateSkillDiscovery } from "../../agent/src/skills.ts";

export const SKILLS_DIR = resolveSkillsDir();
const skillsDir = () => resolveSkillsDir();

const DEFAULT_REPO_DIRS = new Map(CURATED_SKILL_REPOSITORIES.map(entry => [entry.repo.replace("/", "-"), entry]));

export const CORE_SKILL_NAMES = CURATED_SKILL_REPOSITORIES.flatMap(entry => entry.skills.map(skill => skill.name));

/** Path identity avoids attaching curated claims to an unrelated same-name project skill. */
export function curatedSkillInfo(filePath: string) {
  const file = resolve(filePath), normalized = process.platform === "win32" ? file.toLowerCase() : file;
  for (const repository of CURATED_SKILL_REPOSITORIES) {
    for (const skill of repository.skills) {
      const expected = resolve(skillsDir(), repository.repo.replace("/", "-"), "skills", skill.name, "SKILL.md");
      if (normalized === (process.platform === "win32" ? expected.toLowerCase() : expected)) {
        return { repo: repository.repo, expectedRevision: repository.revision, modes: skill.modes, limitations: skill.limitations, reviewedFiles: skill.reviewedFiles };
      }
    }
  }
  return undefined;
}

export function skillPaths(): string[] {
  if (!existsSync(skillsDir())) return [];
  const paths: string[] = [];
  for (const entry of readdirSync(skillsDir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".install-")) continue;
    const curated = DEFAULT_REPO_DIRS.get(entry.name);
    if (curated) {
      const repoPath = join(skillsDir(), entry.name);
      const nestedSkills = join(repoPath, "skills");
      for (const skill of curated.skills) {
        const skillPath = join(nestedSkills, skill.name);
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

export async function installSkills(repo: string, signal?: AbortSignal): Promise<SkillInstallResult> {
  const curated = curatedSkillRepository(repo);
  const result = await installSkillRepository(skillsDir(), curated?.repo ?? repo, undefined, signal, curated ? {
    revision: curated.revision, requiredFiles: curated.skills.map(skill => `skills/${skill.name}/SKILL.md`),
  } : undefined);
  if (result.success) invalidateSkillDiscovery();
  return result;
}

export interface SkillInstallProgress {
  repo: string;
  status: "present" | "installing" | "installed" | "failed" | "cancelled";
  message: string;
}

/** No network for existing directories. Installed does not imply discovered or dependency-ready. */
export async function ensureDefaultSkills(options: { root?: string; git?: SkillGit; signal?: AbortSignal;
  onProgress?: (progress: SkillInstallProgress) => void } = {}): Promise<void> {
  const root = options.root ?? skillsDir();
  for (const curated of CURATED_SKILL_REPOSITORIES) {
    const repo = curated.repo;
    if (options.signal?.aborted) break;
    const target = join(root, repo.replace("/", "-"));
    if (existsSync(target)) {
      options.onProgress?.({ repo, status: "present", message: `${repo}: local directory present; no network update. Skill discovery and dependencies are checked separately.` });
      continue;
    }
    options.onProgress?.({ repo, status: "installing", message: `Installing ${repo} in the background. Existing skills remain available.` });
    const result = await installSkillRepository(root, repo, options.git, options.signal, {
      revision: curated.revision, requiredFiles: curated.skills.map(skill => `skills/${skill.name}/SKILL.md`),
    });
    if (result.success) invalidateSkillDiscovery();
    options.onProgress?.({ repo, status: options.signal?.aborted ? "cancelled" : result.success ? "installed" : "failed", message: result.message });
  }
}
