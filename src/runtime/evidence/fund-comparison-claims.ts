import { unquotedMethodProse } from "./performance-method-claims.ts";

/** Finite explicit direct-comparison claims; not a semantic comparability assessment. */
export function fundComparisonClaimViolations(text: string): string[] {
  const clauses = unquotedMethodProse(text).split(/[。；;.!?！？\n]|\b(?:but|however)\b|但是|但|不过|然而/iu);
  for (const clause of clauses) {
    const direct = /(?:与|和)[^，,。；;\n]{0,28}(?:基金|基准)[^，,。；;\n]{0,12}直接(?:对比|比较)|directly\s+comparable\s+(?:with|to)\s+(?:other\s+)?(?:funds?|benchmarks?)/giu;
    for (const match of clause.matchAll(direct)) {
      const prefix = clause.slice(0, match.index).split(/[，,、]/u).at(-1)!;
      const suffix = clause.slice(match.index! + match[0].length).split(/[，,]/u)[0]!;
      if (/(?:不能|不可|不宜|不应|无法|不直接)|\b(?:not|cannot|can't|isn't|aren't)\b/iu.test(prefix + match[0])
        || /(?:误导|不合理|无效|不成立|不可取|不宜|错误)|\b(?:misleading|invalid|incorrect|wrong)\b/iu.test(suffix)) continue;
      const aligned = /同一(?:估值)?(?:窗口|区间|期间)|matching\s+(?:valuation\s+)?period/iu.test(clause)
        && /同(?:一)?币种|same\s+currency/iu.test(clause)
        && /(?:费率|费用|手续费)[^，,、。；;\n不非]{0,24}(?:一致|相同)|(?<!not\s)consistent\s+fee/iu.test(clause)
        && /(?:分红|分配)[^，,、。；;\n不非]{0,24}(?:一致|相同)|(?<!not\s)consistent\s+distribution/iu.test(clause);
      if (!aligned) return ["unaligned-direct-twr-comparison"];
    }
  }
  return [];
}
