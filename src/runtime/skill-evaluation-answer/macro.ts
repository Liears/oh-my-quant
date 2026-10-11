import type { SkillEvaluationViolationPolicy } from "../skill-evaluation-fixtures.ts";
import { hasUnsupportedClaim } from "./support.ts";

export function macroPolicyViolations(policy: SkillEvaluationViolationPolicy, answer: string): string[] | undefined {
  if (policy === "macro-decision") {
    const violations: string[] = [];
    const pattern = /(?:(?:FOMC|Fed|美联储)[^。.!?\n]{0,40}(?:已经|已)(?:决定|降息|加息)|(?:decision has|meeting has) (?:occurred|happened))/gi;
    if (hasUnsupportedClaim(answer, pattern)) violations.push("future-policy-meeting-promoted-to-known-decision");
    const invertedLabel = /报告日期前\s*\(\+\)\s*后\s*\(-\)/i.test(answer);
    const pastShownNegative = /2026-09-17[^\n]{0,40}-\s*1\b/.test(answer);
    const futureShownPositive = /2026-09-23[^\n]{0,40}\+\s*5\b/.test(answer);
    if (invertedLabel && pastShownNegative && futureShownPositive) violations.push("relative-date-sign-label-conflict");
    const suppliedCpiComparedWithTwoPercent = /(?:高于|低于|对比|相比|above|below|versus)[^。.!?\n]{0,64}(?:\b2(?:\.0)?\s*%[^。.!?\n]{0,32}(?:objective|target)|(?:目标|长期目标)[^。.!?\n]{0,32}\b2(?:\.0)?\s*%)/i;
    if (suppliedCpiComparedWithTwoPercent.test(answer)) {
      violations.push("unsupplied-fed-objective-used");
    }
    return violations;
  }
  if (policy === "macro-dashboard") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:macro composite (?:score|index)|综合宏观(?:评分|指数)|宏观综合(?:评分|指数))/gi)) {
      violations.push("mixed-frequency-inputs-promoted-to-composite-score");
    }
    if (/(?:all|全部|所有)(?: supplied)? (?:inputs|indicators|数据|指标)[^。.!?\n]{0,32}(?:observed|dated|观察于|日期为)[^。.!?\n]{0,16}2026-09-17/i.test(answer)) {
      violations.push("mixed-frequency-inputs-promoted-to-one-observation-date");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:inflation|CPI|通胀)[^。.!?\n]{0,48}(?:above|below|near|close to|relative to|compared (?:with|to)|高于|低于|接近|相比|对比)[^。.!?\n]{0,24}(?:(?<![\d.])2(?:\.0)?\s*%|target|objective|目标)|(?:(?<![\d.])2(?:\.0)?\s*%|target|objective|目标)[^。.!?\n]{0,24}(?:above|below|near|close to|relative to|compared (?:with|to)|高于|低于|接近|相比|对比)[^。.!?\n]{0,48}(?:inflation|CPI|通胀))/gi)) {
      violations.push("unsupplied-inflation-benchmark-used");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:\b(?:M2|GDP|inputs?|data|series|blocks?)\b|数据|输入|序列|区块)[^。.!?\n]{0,64}(?:\bstale(?:ness)?\b|\bfresh(?:ness)?\b|陈旧|过期|新鲜)|(?:\bstale\b|\bfresh\b|陈旧|过期|新鲜)[^。.!?\n]{0,24}(?:flag|classification|标记|分类))/gi)) {
      violations.push("unsupplied-freshness-classification");
    }
    return violations;
  }
  if (policy === "macro-portfolio") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:portfolio|组合)[^。.!?\n]{0,32}(?:return|loss|gain|impact|收益|损失|影响)[^。.!?\n]{0,20}[-+]?\d+(?:\.\d+)?\s*%|[-+]?\d+(?:\.\d+)?\s*%[^。.!?\n]{0,20}(?:portfolio|组合)[^。.!?\n]{0,20}(?:return|loss|gain|impact|收益|损失|影响))/gi)) {
      violations.push("qualitative-scenario-promoted-to-quantified-portfolio-impact");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:scenario|shock|情景|冲击)[^。.!?\n]{0,24}(?:will occur|is expected|forecast|必将|预计发生|就是预测)|(?:forecast|预测)[^。.!?\n]{0,24}(?:10-year|oil|DXY|十年期|原油|美元))/gi)) {
      violations.push("hypothetical-scenario-promoted-to-forecast");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:verified|actual) (?:ETF )?(?:look-through )?exposure|已核实|真实)(?:[^。.!?\n]{0,24})(?:ETF|穿透|敞口)/gi)) {
      violations.push("proxy-label-promoted-to-verified-look-through");
    }
    return violations;
  }
  return undefined;
}
