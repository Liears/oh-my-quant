import { hasUnsupportedClaim } from "./claim-qualification.ts";

/** Finite checks against supplied horizon and unit requirements; no option contract is inferred. */
export function hedgeFrameworkClaimViolations(answer: string, protectionHorizon?: string): string[] {
  const violations = new Set<string>();
  const scenarios = answer.split("\n").filter(line => /(?:[+-]\d+(?:\.\d+)?\s*%|Back to cost|回本|情景)[^\n]{0,40}\d/iu.test(line)
    && !/\b(?:if|assuming|depends on|unquantifiable)\b|如果|若|取决于|不可量化/iu.test(line)).join("\n");
  if (hasUnsupportedClaim(scenarios, /(?:collar cap|call leg binds|领口(?:上限|封顶)|卖出看涨(?:期权)?(?:触及|生效))/gi)) {
    violations.add("unsupplied-strike-promoted-to-scenario-cap");
  }
  const comparisons = answer.split("\n").filter(line => !/(?:除以|换算|转换|折算)[^\n]{0,24}(?:乘数|每股)|(?:divid\w*|convert\w*|normali[sz]\w*)[^\n]{0,40}(?:multiplier|per[- ]share|per[- ]contract)/iu.test(line)).join("\n");
  if (hasUnsupportedClaim(comparisons, /(?:每(?:份|张)合约|(?:cost|premium) per contract)[^。.!?\n]{0,32}(?:与|和|with|to)\s*(?:(?:USD|\$|美元)?\s*\d+(?:\.\d+)?\s*[/／](?:share|股)|每股|per[- ]share)[^。.!?\n]{0,24}(?:比较|对比|budget)/gi)) {
    violations.add("contract-cost-compared-to-per-share-budget");
  }
  for (const line of answer.split("\n")) {
    let contractCost = false;
    for (const clause of line.split(/[;；]/u)) {
      const contract = /每(?:份|张)合约(?:的)?[^。!?\n]{0,16}(?:成本|溢价)|(?:cost|premium) per contract|per[- ]contract (?:cost|premium)/iu.test(clause);
      const normalized = /除以[^。!?\n]{0,12}(?:合约)?乘数[^。!?\n]{0,24}每股|divid\w*[^。!?\n]{0,60}multiplier[^。!?\n]{0,40}per[- ]share/iu.test(clause);
      const total = /(?:乘以|[×*])\s*合约数量[^。!?\n]{0,24}总(?:对冲)?成本|(?:multiply|times)[^。!?\n]{0,40}contract count[^。!?\n]{0,40}total cost/iu.test(clause);
      if (normalized || total || !contract && /每股(?:成本|溢价|权利金)|per[- ]share (?:cost|premium)/iu.test(clause)) contractCost = false;
      else if (contract) contractCost = true;
      if (contractCost
        && hasUnsupportedClaim(clause, /(?:(?:USD|\$|美元)\s*\d+(?:\.\d+)?\s*(?:[/／]share|每股|per[- ]share)|每股(?:预算|上限)|per[- ]share\s+budget)/gi)
        && hasUnsupportedClaim(clause, /(?:比较|对比|compar\w*|screen)/gi)) {
        violations.add("contract-cost-compared-to-per-share-budget");
      }
    }
    if (!protectionHorizon || !/^\d{4}-\d{2}-\d{2}$/u.test(protectionHorizon)) continue;
    for (const claim of line.split(/\b(?:but|however|yet)\b|但是|然而|不过/iu)) {
      const sameDateReference = [...claim.matchAll(/\d{4}-\d{2}-\d{2}/gu)].every(match => match[0] === protectionHorizon);
      const coverageTarget = sameDateReference ? `(?:${protectionHorizon}|that date)` : protectionHorizon;
      const conditionalRollover = /若|如果|\b(?:if|only with|provided that)\b/iu.test(claim)
        && new RegExp(`(?:滚动[^。!?\\n]{0,32}(?:持续|连续)(?:保护|覆盖)至|roll\\w*[^。!?\\n]{0,48}(?:cover|protect)\\w*[^。!?\\n]{0,20}(?:through|to))\\s*${coverageTarget}`, "iu").test(claim);
      const early = new RegExp(`(?:到期(?:日|日期)[^。!?;；\\n]{0,20}(?:${protectionHorizon}\\s*(?:或|及)?之前|早于\\s*${protectionHorizon})|${protectionHorizon}\\s*(?:或|及)?之前(?:的)?到期日|expir(?:y|ation)(?: date)?[^。!?;；\\n]{0,40}(?:on or before|before|no later than)\\s*${protectionHorizon})`, "giu");
      const expiryClaims = claim.replace(new RegExp(`(?:^|:\\s*)(?:[-*]\\s*)?reject any expiry(?: ending)? before\\s*${protectionHorizon}`, "giu"),
        `do not choose an expiry before ${protectionHorizon}`);
      const explicitApproval = new RegExp(`\\bdo not reject any expiry(?: ending)? before\\s*${protectionHorizon}`, "iu").test(claim);
      if (!conditionalRollover && (explicitApproval || hasUnsupportedClaim(expiryClaims, early))) violations.add("hedge-expiry-before-protection-horizon");
    }
  }
  return [...violations];
}
