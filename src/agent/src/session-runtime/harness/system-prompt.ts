import { dirname } from "node:path";
import { formatSkillsForPrompt, createSyntheticSourceInfo } from "../../pi-skills.ts";
import type { Skill } from "./types.ts";

/** Adapt the retained session Skill shape to Pi's public prompt formatter. */
export function formatSkillsForSystemPrompt(skills: Skill[]): string {
  return formatSkillsForPrompt(skills.map(skill => ({ ...skill, baseDir: dirname(skill.filePath),
    disableModelInvocation: skill.disableModelInvocation ?? false,
    sourceInfo: createSyntheticSourceInfo(skill.filePath, { source: "local" }) })), "bash");
}
