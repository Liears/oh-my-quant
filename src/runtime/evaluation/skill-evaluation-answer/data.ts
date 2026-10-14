import type { SkillEvaluationViolationPolicy } from "../skill-evaluation-fixtures.ts";
import { hasUnsupportedClaim } from "../../evidence/claim-qualification.ts";

export function dataPolicyViolations(policy: SkillEvaluationViolationPolicy, answer: string): string[] | undefined {
  if (policy === "none") return [];
  if (policy === "macro-brief") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:Fed|FOMC|美联储)[^。.!?\n]{0,32}(?:will|certain(?:ly)?|必将|一定会)(?:[^。.!?\n]{0,12})(?:cut|raise|降息|加息)|(?:certain|确定的?)(?:政策|Fed|FOMC)[^。.!?\n]{0,24}(?:path|行动|路径))/gi)) {
      violations.push("uncertain-policy-path-promoted-to-certain");
    }
    if (hasUnsupportedClaim(answer, /(?:CPI|unemployment|失业率|通胀)[^。.!?\n]{0,16}(?:\bis\b|\bare\b|是|属于|作为)[^。.!?\n]{0,12}(?:intraday|real[- ]?time|盘中|实时)/gi)) {
      violations.push("monthly-macro-promoted-to-intraday");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:inflation|CPI|通胀)[^。.!?\n]{0,48}(?:above|below|near|close to|relative to|compared (?:with|to)|高于|低于|接近|相比|对比)[^。.!?\n]{0,24}(?:target|objective|目标(?:区域)?)|(?:target|objective|目标(?:区域)?)[^。.!?\n]{0,24}(?:above|below|near|close to|relative to|compared (?:with|to)|高于|低于|接近|相比|对比)[^。.!?\n]{0,48}(?:inflation|CPI|通胀))/gi)) {
      violations.push("unsupplied-inflation-benchmark-used");
    }
    return violations;
  }
  if (policy === "holders-13f") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:current|live)(?: institutional)? (?:owners?|holders?)\s*(?::|are\b|include\b)|[A-Za-z][A-Za-z0-9_-]*\s+(?:is\s+)?(?:a\s+)?current(?: institutional)? (?:owner|holder)|(?:currently|now) holds?|当前(?:机构)?(?:持有人|股东|持仓)(?:为|是|包括|包含)|[\p{L}\p{N}_-]+(?:当前|现在)持有)/giu)) {
      violations.push("historical-13f-promoted-to-current-ownership");
    }
    // Absence itself has negative grammar; preserve any separate denial of its alleged implication.
    const absenceClaims = answer.replace(/未上榜|不存在于名单/gu, "缺席").replace(/not (?:listed|present)/giu, "absence");
    const absencePattern = /(?:absence[^。.!?\n]{0,40}(?:short position|is short|zero ownership)|缺席[^。.!?\n]{0,32}(?:空头|做空|零持仓))/gi;
    const implicationDenial = /不能|不可|不是|并非|不证明|不代表|\b(?:not|cannot|can't|doesn't)\b/iu;
    if (absenceClaims.split(/[。;；!?！？\n]|\b(?:but|however|yet)\b|但是|但|然而/iu).some(clause =>
      [...clause.matchAll(absencePattern)].some(match => !implicationDenial.test(match[0]))
      && hasUnsupportedClaim(clause, absencePattern))) {
      violations.push("13f-absence-promoted-to-short-or-zero");
    }
    const assertedCoverage = /(?:现已|已经|已)(?:涵盖|覆盖|提供|获取|具备|包括)|\b(?:covers?|includes?|(?:is|has been|already)\s+(?:provided|covered|obtained|available))\b/iu;
    let pendingChecks = false;
    const coverageLines = answer.split("\n").map(line => {
      if (/^\s*(?:\d+[.)]\s*)?(?:Follow[- ]Up Checks|后续检查|待补充检查)\s*[(（][^\n]*(?:not executed|未执行)[^\n]*[)）]\s*:?\s*$/iu.test(line)) {
        pendingChecks = true;
        return line;
      }
      if (!/^\s*[-*]\s+/u.test(line)) { pendingChecks = false; return line; }
      return pendingChecks && !assertedCoverage.test(line)
        && /^\s*[-*]\s*(?:(?:full|entire|all) SEC filer universe\s+comparison|完整\s*SEC\s*(?:申报|机构)[^。\n]{0,20}(?:比较|对比))/iu.test(line)
        ? `Required ${line.replace(/^\s*[-*]\s+/u, "")}` : line;
    });
    const coverageClaims = coverageLines.filter(line =>
      !/^\s*(?:[-*]\s*)?(?:所需的|待补充的|required\s+|needed\s+|requested\s+)(?:full|entire|all|完整|全部)\s*SEC/iu.test(line)
      || assertedCoverage.test(line)).filter(line => assertedCoverage.test(line)
        || !/(?:完整的?\s*SEC\s*(?:申报|机构)|(?:full|entire|all) SEC filer universe)[^。.!?\n]{0,40}(?:对比|比较|comparison)[^。.!?\n]{0,24}(?:需要|未提供|缺少|missing|required|needed)/iu.test(line)).join("\n");
    if (hasUnsupportedClaim(coverageClaims, /(?:(?:full|entire|all) SEC filer universe|全部\s*SEC\s*(?:申报|机构)|完整的?\s*SEC\s*(?:申报|机构))/gi)) {
      violations.push("top-1000-promoted-to-full-sec-universe");
    }
    return violations;
  }
  if (policy === "macro-snapshot") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:confirmed|durable|definitive) regime change|regime (?:has )?changed|(?:确认|确定|持续)的?宏观状态变化|宏观状态已经改变)/gi)) {
      violations.push("two-month-snapshot-promoted-to-durable-regime-change");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:Fed|FOMC|美联储)[^。.!?\n]{0,32}(?:will|certain(?:ly)?|必将|一定会)[^。.!?\n]{0,16}(?:cut|raise|降息|加息))/gi)) {
      violations.push("uncertain-policy-path-promoted-to-certain");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:inflation|CPI|通胀)[^。.!?\n]{0,48}(?:above|below|near|close to|relative to|compared (?:with|to)|高于|低于|接近|相比|对比)[^。.!?\n]{0,24}(?:(?<![\d.])2(?:\.0)?\s*%|target|objective|目标)|(?:(?<![\d.])2(?:\.0)?\s*%|target|objective|目标)[^。.!?\n]{0,24}(?:above|below|near|close to|relative to|compared (?:with|to)|高于|低于|接近|相比|对比)[^。.!?\n]{0,48}(?:inflation|CPI|通胀))/gi)) {
      violations.push("unsupplied-inflation-benchmark-used");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:current|intraday|real[- ]?time) (?:macro|CPI|payroll|Fed funds)|(?:当前|盘中|实时)(?:宏观|CPI|就业|联邦基金))/gi)) {
      violations.push("closed-macro-observation-promoted-to-current-or-intraday");
    }
    return violations;
  }
  return undefined;
}
