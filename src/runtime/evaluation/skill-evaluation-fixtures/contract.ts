import {
  type PositionScenarioInputs, type WeightedScoreComponent,
} from "../../../quant/index.ts";

export const SKILL_EVALUATION_CASES = [
  "skill-risk-health",
  "skill-data-10k",
  "skill-macro-fed",
  "skill-equities-compare",
  "skill-portfolio-thesis",
  "skill-data-macro-brief",
  "skill-macro-dashboard",
  "skill-equities-memo",
  "skill-portfolio-alert",
  "skill-risk-vix",
  "skill-data-holders",
  "skill-data-us-macro",
  "skill-macro-portfolio-impact",
  "skill-equities-five-lens",
  "skill-equities-merger-arb",
  "skill-equities-take-profit",
  "skill-portfolio-profile",
  "skill-portfolio-theme",
  "skill-portfolio-watchlist",
  "skill-risk-fear-score",
  "skill-risk-hedge",
] as const;

export type SkillEvaluationCase = typeof SKILL_EVALUATION_CASES[number];

export type SkillEvaluationViolationPolicy = "risk-observation" | "macro-decision" | "equities-comparison" | "portfolio-trigger"
  | "macro-brief" | "macro-dashboard" | "equity-memo" | "alert-draft" | "vix-close" | "holders-13f"
  | "macro-snapshot" | "macro-portfolio" | "five-lens" | "merger-arb" | "take-profit" | "profile-draft"
  | "theme-draft" | "watchlist-summary" | "fear-score" | "hedge-framework" | "none";

export interface SkillEvaluationFixture {
  id: SkillEvaluationCase;
  skill: string;
  workflow: string;
  workflowMarker: string;
  injectionNeedles: readonly string[];
  evidencePatterns: readonly RegExp[];
  datePatterns: readonly RegExp[];
  violationPolicy: SkillEvaluationViolationPolicy;
  protectionHorizon?: string;
  hedgePosition?: PositionScenarioInputs;
  weightedScore?: { subject: string; observationDate: string; components: WeightedScoreComponent[] };
  prompt: string;
}

export const COMMON_OPENING = "Use only the limited supplied evidence mode. Do not access external data and do not modify profiles, theses, themes, alerts, or files.";
export const COMMON_CLOSING = [
  "Route to the single closest local workflow, open only that workflow, then return its requested sections.",
  "Preserve every supplied date, distinguish supplied facts from missing live or workspace evidence, and state that no external lookup or mutation was performed.",
  "Measure relative time only from the supplied report date 2026-09-18. Never use today, now, current date, or 距今 as the as-of reference.",
];
