import { compareTotalReturns } from "../../quant/index.ts";
import { unquotedMethodProse } from "./performance-method-claims.ts";
import type { VerifiedPortfolioAnswerMetrics } from "./portfolio-answer-claims.ts";

/** Finite affirmative named-subject claims, only with an already verified benchmark. */
export function portfolioRelativeClaimViolations(text: string, evidence: VerifiedPortfolioAnswerMetrics,
  benchmark: { name: string; totalReturn: number } | undefined): string[] {
  if (!benchmark || !Number.isFinite(benchmark.totalReturn)) return [];
  const violations = new Set<string>();
  const escapedBenchmark = benchmark.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const target = `(?:基准|(?:the\\s+)?benchmark|${escapedBenchmark}(?![\\p{L}\\p{N}_]))`;
  const relations = [
    ["outperformed", `(?:跑赢|胜过|超过|优于)\\s*${target}|(?:outperformed|beat)\\s+${target}`],
    ["underperformed", `(?:跑输|落后于?|低于)\\s*${target}|(?:underperformed|lagged)\\s+${target}`],
    ["matched", `与\\s*${target}\\s*(?:收益)?\\s*(?:持平|相同|一致)|(?:matched|tied)\\s+${target}`],
  ] as const;
  const prose = unquotedMethodProse(text).replace(/\*\*/gu, "");
  for (const index of [0, 1] as const) {
    const expected = compareTotalReturns(evidence.groups[index].totalReturn, benchmark.totalReturn).direction;
    const aliases = [evidence.groups[index].name, `Portfolio ${index === 0 ? "A" : "B"}`, `组合${index === 0 ? "A" : "B"}`];
    for (const alias of aliases) {
      const name = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      for (const [direction, relation] of relations) {
        if (direction === expected) continue;
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${name}\\s*(?:(?:的?收益|总收益|累计收益|total\\s+return)\\s*)?(?:${relation})`, "giu");
        for (const clause of prose.split(/[。；;!?！？\n]|\b(?:but|however|yet)\b|但是|然而|不过/iu)) {
          for (const match of clause.matchAll(pattern)) {
            if (/(?:错误|误称|有人|如果|假如|若|并非|不是)|\b(?:if|incorrect|wrong|mistaken|claimed)\b/iu.test(clause.slice(0, match.index))) continue;
            if (/(?:不正确|不成立)|\b(?:incorrect|wrong)\b/iu.test(clause.slice(match.index! + match[0].length))) continue;
            if (/^\s*(?:(?:in|on|for)\s+|['’]s\s+)?(?:(?:observed|maximum|max|annual(?:ized)?|sample)\s+)*(?:drawdown|DD\b|volatility|Sharpe\b|VaR\b|CVaR\b|CAGR\b|risk\b)/iu
              .test(clause.slice(match.index! + match[0].length))) continue;
            violations.add(`wrong-verified-portfolio-${index === 0 ? "a" : "b"}-benchmark-direction`);
          }
        }
      }
    }
  }
  return [...violations];
}
