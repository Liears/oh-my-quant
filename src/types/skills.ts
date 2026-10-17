/** Skill entry for TUI suggestions and CLI listing. */
export interface SkillEntry {
  name: string;
  description: string;
  scope: "project" | "user";
}

export interface SkillRequirementCheck {
  requirement: string;
  status: "available" | "missing" | "unverified" | "input-required";
  reason: string;
  /** Optional tool binding for custom host policies. */
  requiresTools?: string[];
}

/** Skill invocation state for conversation rendering. */
export interface SkillState {
  name: string;
  label: string;
  status: "running" | "done" | "error";
  startedAt: number;
}
