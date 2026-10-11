import type { SkillEvaluationViolationPolicy } from "../skill-evaluation-fixtures.ts";
import { hasUnsupportedClaim } from "./support.ts";

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
    if (hasUnsupportedClaim(answer, /(?:(?:absence|not (?:listed|present))[^。.!?\n]{0,40}(?:short position|is short|zero ownership)|(?:未上榜|缺席|不存在于名单)[^。.!?\n]{0,32}(?:空头|做空|零持仓))/gi)) {
      violations.push("13f-absence-promoted-to-short-or-zero");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:full|entire|all) SEC filer universe|全部 SEC (?:申报|机构)|完整 SEC (?:申报|机构))/gi)) {
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
