import { calculateWeightedScore, type WeightedScoreComponent } from "../../quant/index.ts";
import { unquotedMethodProse } from "./performance-method-claims.ts";
import { hasUnsupportedClaim } from "./claim-qualification.ts";

/** Finite labelled total and driver claims bound to supplied inputs; not a general interpretation judge. */
export function weightedScoreAnswerViolations(answer: string, supplied?: readonly WeightedScoreComponent[]): string[] {
  if (!supplied) return [];
  const expected = calculateWeightedScore(supplied), violations = new Set<string>();
  const largest = new Set(expected.largestContributors);
  const labels = supplied.map(component => component.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s*")).join("|");
  const names = new RegExp(`(?<![A-Za-z0-9_])(?:${labels})(?![A-Za-z0-9_])`, "giu");
  const driver = /(?:加权)?贡献(?:值)?(?:为|是)?最大|最大(?:加权)?贡献|(?:largest|highest|biggest)\s+(?:weighted\s+)?contribut(?:ion|or)|(?:weighted\s+)?contribution\s+(?:is\s+)?(?:the\s+)?(?:largest|highest|biggest)/giu;
  for (const clause of unquotedMethodProse(answer).split(/[。；;!?！？\n]|(?<!\d)\.(?!\d)|\b(?:but|however)\b|但(?:是)?|然而/iu)) {
    const matches = [...clause.matchAll(names)];
    for (let index = 0; index < matches.length; index++) {
      const match = matches[index]!, start = match.index!, previousEnd = index ? matches[index - 1]!.index! + matches[index - 1]![0].length : 0;
      const prefix = clause.slice(Math.max(previousEnd, start - 32), start);
      const segment = clause.slice(start, matches[index + 1]?.index ?? clause.length);
      const component = supplied.find(item => item.name.replace(/\s+/gu, "").toLowerCase() === match[0].replace(/\s+/gu, "").toLowerCase())!;
      for (const claim of segment.matchAll(driver)) {
        const assertion = prefix + segment.slice(0, claim.index! + claim[0].length);
        if (!largest.has(component.name) && hasUnsupportedClaim(assertion, new RegExp(`${driver.source}$`, driver.flags))) {
          violations.add("wrong-weighted-score-largest-contributor");
        }
      }
    }
    const total = /(?:未舍入(?:的)?(?:加权)?(?:合计|总分)|加权(?:合计|总分)|unrounded\s+(?:composite\s+)?(?:total|score)|weighted\s+(?:composite\s+)?total)\s*[:：=]?\s*(?:为|是|is|=)?\s*(\d+(?:\.\d+)?)/iu.exec(clause);
    if (total) {
      const decimals = total[1]!.split(".")[1]?.length ?? 0;
      if (Math.abs(Number(total[1]) - expected.score) > 0.5 * 10 ** -decimals + 1e-10) violations.add("wrong-weighted-score-total");
    }
  }
  return [...violations];
}
