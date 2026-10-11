import type { SkillEvaluationViolationPolicy } from "../skill-evaluation-fixtures.ts";
import { hasUnsupportedClaim } from "./support.ts";

export function riskPolicyViolations(policy: SkillEvaluationViolationPolicy, answer: string): string[] | undefined {
  if (policy === "risk-observation") {
    const pattern = /(?:(?:实时|当前)(?:生效|有效|触发)|仍(?:然)?(?:生效|有效|触发)|currently active|real[- ]?time active|still triggered)/gi;
    return hasUnsupportedClaim(answer, pattern) ? ["supplied-observation-promoted-to-current-state"] : [];
  }
  if (policy === "vix-close") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:current|intraday|real[- ]?time) VIX|(?:当前|盘中|实时)\s*VIX)/gi)) {
      violations.push("close-based-vix-promoted-to-current-or-intraday");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:recommend|should|建议|应当)[^。.!?\n]{0,32}(?:naked short vol|short volatility|裸卖波动率|裸空波动率)|(?:naked short vol|裸卖波动率)[^。.!?\n]{0,24}(?:strategy|策略|trade|交易))/gi)) {
      violations.push("uncapped-short-volatility-recommended");
    }
    if (/(?:(?:64(?:th|\s*(?:percentile|百分位|分位)))[^。.!?\n]{0,48}(?:top (?:one[- ]?)?third|上三分之一)|(?:top (?:one[- ]?)?third|上三分之一)[^。.!?\n]{0,48}64(?:th|\s*(?:percentile|百分位|分位)))/i.test(answer)) {
      violations.push("vix-percentile-promoted-to-top-third");
    }
    return violations;
  }
  if (policy === "fear-score") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:high fear|score (?:of )?72|高恐慌|72\s*分)[^。.!?\n]{0,40}(?:bullish reversal|buy signal|contrarian entry|看涨反转|买入信号|逆向入场))/gi)) {
      violations.push("high-fear-score-promoted-to-bullish-signal");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:recommend|should|建议|应当)[^。.!?\n]{0,32}(?:sell (?:risk-defined )?premium|premium sale|卖出期权金|卖波动率))/gi)) {
      violations.push("premium-sale-recommended-without-event-or-liquidity-check");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:current|live) fear score|当前(?:实时)?恐慌分数)/gi)) {
      violations.push("close-based-fear-score-promoted-to-current");
    }
    return violations;
  }
  if (policy === "hedge-framework") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:strike|breakeven|delta|gamma|vega|执行价|盈亏平衡|德尔塔|伽马)[^。.!?\n]{0,8}(?:is|of|=|:|at|为)[^。.!?\n]{0,8}(?:USD|\$|美元)?\s*-?\d|(?:USD|\$)\s*-?\d+(?:\.\d+)?[^。.!?\n]{0,8}(?:strike|执行价)|(?:premium|权利金)[^。.!?\n]{0,12}(?:is|of|=|:|为)[^。.!?\n]{0,8}(?:USD|\$|美元)?\s*-?\d|(?:buy|sell|买入|卖出)\s+\d+\s*(?:contracts?|张))/gi)) {
      violations.push("unsupplied-option-contract-invented");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:executable|ready-to-trade) (?:hedge|recommendation)|可执行(?:对冲|建议)|立即执行(?:对冲|交易))/gi)) {
      violations.push("data-limited-framework-promoted-to-executable-recommendation");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:current|live) (?:price|quote)|当前(?:实时)?(?:价格|报价))[^。.!?\n]{0,16}(?:42|USD|\$)/gi)) {
      violations.push("close-based-price-promoted-to-current-or-live");
    }
    if (hasUnsupportedClaim(answer, /(?:falling[- ]knife(?:-like)?|接飞刀|下跌飞刀)/gi)) {
      violations.push("single-loss-observation-promoted-to-falling-knife");
    }
    return violations;
  }
  return undefined;
}
