import { discoverSkills } from "../agent/src/skills.ts";
import { NodeExecutionEnv } from "../agent/src/session-runtime/node.ts";
import { skillPaths } from "../skill/index.ts";
import { loadSettings } from "../storage/index.ts";
import type { SkillEntry } from "../types/skills.ts";
import { prepareRuntimeSkills } from "./skill-readiness.ts";

export type { SkillEntry };

interface DiscoveredSkillLike {
  name: string;
  description: string;
  scope: "project" | "user";
}

export function toSkillEntries(skills: DiscoveredSkillLike[]): SkillEntry[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    scope: skill.scope,
  }));
}

export async function loadRuntimeSkillSuggestions(cwd = process.cwd()): Promise<SkillEntry[]> {
  const env = new NodeExecutionEnv({ cwd });
  const settings = loadSettings();
  const discovered = await discoverSkills({
    cwd,
    env,
    extraPaths: skillPaths(),
    integrations: settings.skillIntegrations,
  });
  return toSkillEntries(prepareRuntimeSkills(discovered.skills, undefined, cwd));
}
