import { discoverRuntimeSkills } from "./skill-discovery.ts";
import type { SkillEntry } from "../../types/skills.ts";
export type { SkillEntry };

export function toSkillEntries(skills: SkillEntry[]): SkillEntry[] {
  return skills.map(({ name, description, scope }) => ({ name, description, scope }));
}

export async function loadRuntimeSkillSuggestions(cwd = process.cwd()): Promise<SkillEntry[]> {
  return toSkillEntries(await discoverRuntimeSkills(cwd));
}
