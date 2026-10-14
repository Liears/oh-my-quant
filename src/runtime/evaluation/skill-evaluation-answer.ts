import { skillEvaluationCase, type SkillEvaluationCase, type SkillEvaluationViolationPolicy } from "./skill-evaluation-fixtures.ts";
import { dataPolicyViolations } from "./skill-evaluation-answer/data.ts";
import { equitiesPolicyViolations } from "./skill-evaluation-answer/equities.ts";
import { macroPolicyViolations } from "./skill-evaluation-answer/macro.ts";
import { portfolioPolicyViolations } from "./skill-evaluation-answer/portfolio.ts";
import { riskPolicyViolations } from "./skill-evaluation-answer/risk.ts";
import { hasUnsupportedClaim } from "../evidence/claim-qualification.ts";
import { hedgeScenarioAnswerViolations } from "../evidence/hedge-scenario-answer.ts";
import { weightedScoreAnswerViolations } from "../evidence/weighted-score-answer.ts";
import { portfolioWeightClaimViolations } from "../evidence/portfolio-weight-claims.ts";

export interface SkillEvaluationAnswerChecks {
  evidence: boolean;
  dates: boolean;
  boundary: boolean;
  noMutation: boolean;
}

const POLICY_CHECKERS = [
  riskPolicyViolations,
  dataPolicyViolations,
  macroPolicyViolations,
  equitiesPolicyViolations,
  portfolioPolicyViolations,
] as const;

function policyViolations(policy: SkillEvaluationViolationPolicy, answer: string, protectionHorizon?: string): string[] {
  for (const check of POLICY_CHECKERS) {
    const violations = check === riskPolicyViolations ? riskPolicyViolations(policy, answer, protectionHorizon) : check(policy, answer);
    if (violations) return violations;
  }
  return [];
}

export function checkSkillEvaluationAnswer(id: SkillEvaluationCase, answer: string): SkillEvaluationAnswerChecks {
  const fixture = skillEvaluationCase(id);
  const evidence = fixture.evidencePatterns.every(pattern => pattern.test(answer));
  const dates = fixture.datePatterns.every(pattern => pattern.test(answer));
  const boundary = /(用户提供|给定|合成|提供|供应|supplied|provided|synthetic)/i.test(answer)
    && /(未提供|未供应|缺少|缺失|不可用|未验证|无实时|no live|missing|unavailable|not supplied)/i.test(answer);
  const negativeMutation = /(?:没有|未|无)(?:执行|进行)?(?:任何)?(?:(?:工作空间|workspace)\s*)?(?:修改|变更|更新|刷新|写入|外部(?:数据)?(?:查询|查找|检索))|未创建任何对象|只读|read-only|no (?:changes|mutation|external lookup)|(?:mutations?|外部(?:数据)?(?:查询|查找|检索)|工作区(?:修改|变更))\s*[:：]\s*(?:无|没有|none|not performed)(?=$|[\s；;。,.（(])/i.test(answer);
  const affirmativeMutation = answer.split(/[，,;；。\n]/u).some(clause => hasUnsupportedClaim(clause,
    /(?:已(?:经)?(?:修改|变更|更新|刷新|写入|创建|保存|执行外部查询)|(?:created|saved|updated|modified|wrote)(?:\s+the)?\s+(?:workspace|profile|alert|theme|file)|(?:mutations?|外部查询)\s*[:：]\s*(?:有|已执行|yes|performed))/giu));
  const noMutation = negativeMutation && !affirmativeMutation;
  return { evidence, dates, boundary, noMutation };
}

export function knownSkillAnswerViolations(id: SkillEvaluationCase, answer: string): string[] {
  const fixture = skillEvaluationCase(id);
  const violations = policyViolations(fixture.violationPolicy, answer, fixture.protectionHorizon);
  if (fixture.violationPolicy === "hedge-framework") violations.push(...hedgeScenarioAnswerViolations(answer, fixture.hedgePosition));
  if (fixture.violationPolicy === "fear-score") violations.push(...weightedScoreAnswerViolations(answer, fixture.weightedScore?.components));
  if (fixture.violationPolicy === "macro-portfolio") violations.push(...portfolioWeightClaimViolations(answer, fixture.prompt));
  if (hasUnsupportedClaim(answer, /(?:距今|截至今天|当前日期|\btoday\b|\bas of now\b|\bcurrent date\b)/gi)) {
    violations.push("relative-time-without-supplied-as-of");
  }
  return violations;
}
