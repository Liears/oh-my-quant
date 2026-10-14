import type { VerifiedFactorLatest } from "./factor-latest-claims.ts";
import { affirmativeMethodClaimViolations, unquotedMethodProse } from "./performance-method-claims.ts";

const FACTOR = /\b(momentum|reversal|volatility|rsi)\s*[(（]\s*(\d+)\s*[)）]/giu;
const MINIMUM = /(?:至少|最少|需(?:要)?|requires?(?:\s+at least)?|at least)\s*(\d+)\s*(?:个|条)?\s*(?:连续(?:的)?\s*|consecutive\s+)?(?:收盘(?:价)?(?:观测|观察)?|clos(?:es?|ing(?:\s+(?:prices?|observations?))?))/giu;

/** Explicit insufficient close-count assertions for one selected factor/period per line. */
export function factorCloseObservationViolations(text: string, evidence: readonly VerifiedFactorLatest[]): string[] {
  for (const line of unquotedMethodProse(text).split("\n")) {
    const named = [...line.matchAll(FACTOR)];
    if (named.length !== 1) continue;
    const factor = named[0]![1]!.toLowerCase(), period = Number(named[0]![2]);
    if (!evidence.some(item => item.factor === factor && item.period === period)) continue;
    for (const minimum of line.matchAll(MINIMUM)) {
      if (Number(minimum[1]) >= period + 1) continue;
      const literal = minimum[0].replace(/[.*+?^$()|[\]{}\\]/gu, "\\$&");
      const violations = affirmativeMethodClaimViolations(line, [{
        code: "wrong-factor-close-observation-minimum", pattern: new RegExp(literal, "giu"),
      }]);
      if (violations.length) return violations;
    }
  }
  return [];
}
