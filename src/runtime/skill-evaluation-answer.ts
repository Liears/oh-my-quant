import { skillEvaluationCase, type SkillEvaluationCase, type SkillEvaluationViolationPolicy } from "./skill-evaluation-fixtures.ts";
import { dataPolicyViolations } from "./skill-evaluation-answer/data.ts";
import { equitiesPolicyViolations } from "./skill-evaluation-answer/equities.ts";
import { macroPolicyViolations } from "./skill-evaluation-answer/macro.ts";
import { portfolioPolicyViolations } from "./skill-evaluation-answer/portfolio.ts";
import { riskPolicyViolations } from "./skill-evaluation-answer/risk.ts";
import { hasUnsupportedClaim } from "./skill-evaluation-answer/support.ts";

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

function policyViolations(policy: SkillEvaluationViolationPolicy, answer: string): string[] {
  for (const check of POLICY_CHECKERS) {
    const violations = check(policy, answer);
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
  const noMutation = /(?:没有|未|无)(?:执行|进行)?(?:任何)?(?:(?:工作空间|workspace)\s*)?(?:修改|变更|更新|刷新|写入|外部(?:数据)?(?:查询|查找|检索))|未创建任何对象|只读|read-only|no (?:changes|mutation|external lookup)/i.test(answer);
  return { evidence, dates, boundary, noMutation };
}

export function knownSkillAnswerViolations(id: SkillEvaluationCase, answer: string): string[] {
  const violations = policyViolations(skillEvaluationCase(id).violationPolicy, answer);
  if (hasUnsupportedClaim(answer, /(?:距今|截至今天|当前日期|\btoday\b|\bas of now\b|\bcurrent date\b)/gi)) {
    violations.push("relative-time-without-supplied-as-of");
  }
  return violations;
}
