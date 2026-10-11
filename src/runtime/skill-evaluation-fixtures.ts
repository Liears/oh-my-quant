import { DATA_SKILL_EVALUATION_FIXTURES } from "./skill-evaluation-fixtures/data.ts";
import { EQUITIES_SKILL_EVALUATION_FIXTURES } from "./skill-evaluation-fixtures/equities.ts";
import { MACRO_SKILL_EVALUATION_FIXTURES } from "./skill-evaluation-fixtures/macro.ts";
import { PORTFOLIO_SKILL_EVALUATION_FIXTURES } from "./skill-evaluation-fixtures/portfolio.ts";
import { RISK_SKILL_EVALUATION_FIXTURES } from "./skill-evaluation-fixtures/risk.ts";
import { type SkillEvaluationCase, type SkillEvaluationFixture } from "./skill-evaluation-fixtures/contract.ts";

export { SKILL_EVALUATION_CASES } from "./skill-evaluation-fixtures/contract.ts";
export type { SkillEvaluationCase, SkillEvaluationFixture, SkillEvaluationViolationPolicy } from "./skill-evaluation-fixtures/contract.ts";

const FIXTURES = {
  ...RISK_SKILL_EVALUATION_FIXTURES,
  ...DATA_SKILL_EVALUATION_FIXTURES,
  ...MACRO_SKILL_EVALUATION_FIXTURES,
  ...EQUITIES_SKILL_EVALUATION_FIXTURES,
  ...PORTFOLIO_SKILL_EVALUATION_FIXTURES,
} satisfies Readonly<Record<SkillEvaluationCase, SkillEvaluationFixture>>;

export function skillEvaluationCase(id: SkillEvaluationCase): SkillEvaluationFixture {
  const fixture = FIXTURES[id];
  if (!fixture) throw new Error(`Unknown skill evaluation case: ${id}`);
  return fixture;
}
