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
  /** Optional host-tool binding; readiness is revoked when any named tool is inactive. */
  requiresTools?: string[];
}

export interface SkillReadiness {
  status: "requirements-met" | "needs-input" | "blocked" | "unverified";
  modes: Array<{ name: string; status: SkillReadiness["status"]; requirements: SkillRequirementCheck[] }>;
  /** Local dependency observation only; does not certify network or script execution. */
  checkedAt?: string;
}

/** Skill invocation state for conversation rendering. */
export interface SkillState {
  name: string;
  label: string;
  status: "running" | "done" | "error";
  startedAt: number;
}
