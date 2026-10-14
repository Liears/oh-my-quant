import type { SkillEvaluationViolationPolicy } from "../skill-evaluation-fixtures.ts";
import { hasUnsupportedClaim } from "../../evidence/claim-qualification.ts";

export function equitiesPolicyViolations(policy: SkillEvaluationViolationPolicy, answer: string): string[] | undefined {
  if (policy === "equities-comparison") {
    const violations: string[] = [];
    if (/(?:\bnot stale\b|\bis fresh\b|不过期|仍(?:然)?新鲜|并未陈旧)/i.test(answer)) violations.push("unsupplied-freshness-classification");
    if (hasUnsupportedClaim(answer, /(?:composite (?:score|ranking)|综合(?:评分|得分|排名))/gi)) violations.push("incommensurate-metrics-promoted-to-composite-ranking");
    return violations;
  }
  if (policy === "equity-memo") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:latest (?:filing|10-Q)|最新(?:申报|10-Q|财报))/gi)) violations.push("supplied-filing-promoted-to-latest");
    if (hasUnsupportedClaim(answer, /(?:(?:[A-Za-z][A-Za-z0-9_-]*\s+is\s+(?:a\s+)?current(?: institutional)? holder)|(?:current(?: institutional)? (?:owners?|holders?))\s*(?::|are\b|include\b)|current ownership\s+(?:is\b|shows?\b|includes?\b)|[A-Za-z][A-Za-z0-9_-]*\s+currently holds?\b|(?:当前(?:机构)?(?:持有人|股东|持仓))(?:为|是|包括|包含))/gi)) {
      violations.push("historical-13f-promoted-to-current-ownership");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:price target|目标价)[^。.!?\n]{0,24}(?:USD|\$|美元)?[^\S\r\n]*\d|(?:USD|\$)[^\S\r\n]*\d[^。.!?\n]{0,24}(?:price target|目标价))/gi)) {
      violations.push("unsupplied-price-target-invented");
    }
    if (/(?:1\.7\s*x\s*annual revenue|1\.7\s*倍[^。.!?\n]{0,12}年(?:度)?收入)/i.test(answer)) {
      violations.push("quarterly-revenue-promoted-to-annual-denominator");
    }
    if (hasUnsupportedClaim(answer, /(?:\bstale\b|陈旧|过期)/gi)) violations.push("unsupplied-freshness-classification");
    return violations;
  }
  if (policy === "five-lens") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:price target|target price|stop price|stop-loss (?:at|level)|目标价|止损价|止损位)[^。.!?\n]{0,20}(?:USD|\$|美元)?[^\S\r\n]*\d)/gi)) {
      violations.push("unsupplied-target-or-stop-price-invented");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:confidence|置信度|信心)[^。.!?\n]{0,12}\d+(?:\.\d+)?\s*%)/gi)) {
      violations.push("unsupplied-confidence-percentage-invented");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:current|live) fundamentals?|当前(?:实时)?基本面)/gi)) {
      violations.push("historical-fundamentals-promoted-to-current");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:current|live)(?: institutional)? (?:owners?|holders?)\s*(?::|are\b|include\b)|[A-Za-z][A-Za-z0-9_-]*\s+(?:is\s+)?(?:a\s+)?current(?: institutional)? (?:owner|holder)|(?:currently|now) holds?|当前(?:机构)?(?:持有人|股东|持仓)(?:为|是|包括|包含)|[\p{L}\p{N}_-]+(?:当前|现在)持有)/giu)) {
      violations.push("historical-13f-promoted-to-current-ownership");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:ownership|13F|flow|持仓|所有权)[^\n]{0,48}(?:\bstale\b|\bfresh\b|陈旧|过期|新鲜))/gi)) {
      violations.push("unsupplied-freshness-classification");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:trailing|fwd|forward) PE[^\n]{0,100}(?:(?:implied|implies|embeds)[^\n]{0,32}(?:EPS|earnings) growth|(?:EPS|earnings) growth[^\n]{0,24}(?:implied|embedded))|(?:trailing|forward) PE[^\n]{0,100}(?:隐含|推导)[^\n]{0,32}(?:EPS|盈利|利润)增长)/gi)) {
      violations.push("forward-multiple-promoted-to-unsupplied-eps-growth");
    }
    return violations;
  }
  if (policy === "merger-arb") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:completion|close|deal) probability[^。.!?\n]{0,16}\d+(?:\.\d+)?\s*%|(?:完成|交割|交易)(?:概率|成功率)[^。.!?\n]{0,16}\d+(?:\.\d+)?\s*%)/gi)) {
      violations.push("unsupplied-deal-probability-invented");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:will|definitely|certain(?:ly)?) close[^。.!?\n]{0,32}(?:H1 2027|2027|上半年)|(?:必将|确定|一定)(?:在)?[^。.!?\n]{0,20}(?:2027|上半年)[^。.!?\n]{0,12}(?:交割|完成))/gi)) {
      violations.push("expected-close-window-promoted-to-certainty");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:annualized|annualised) (?:return|spread)|年化(?:收益|回报|价差))[^。.!?\n]{0,16}\d+(?:\.\d+)?\s*%/gi)) {
      violations.push("unsupplied-annualized-return-invented");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:borrow (?:is )?available|available borrow)|可借券|借券可用(?!性)|借券可用性(?:已|已经)(?:确认|核实)|(?:已|已经)(?:确认|核实)(?:了)?借券可用性)/gi)) {
      violations.push("unsupplied-borrow-availability-invented");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:deal[- ]break)\s+(?:downside|loss|risk)[^。.!?\n]{0,24}(?:USD|\$)[^\S\r\n]*\d|(?:交易|并购)(?:破裂|失败)[^。.!?\n]{0,24}(?:下行风险|损失|风险总价差)[^。.!?\n]{0,16}(?:USD|\$|美元)[^\S\r\n]*\d)/gi)) {
      violations.push("offer-spread-promoted-to-deal-break-downside");
    }
    return violations;
  }
  if (policy === "take-profit") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:guarantee[sd]?|will ensure|必然|保证)[^。.!?\n]{0,32}(?:future|return|profit|outperform|未来|收益|盈利|跑赢)|(?:universally|always) best|永远最优|普遍最优)/gi)) {
      violations.push("backtest-promoted-to-future-guarantee");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:current|live) (?:price|quote)|当前(?:实时)?(?:价格|报价))[^。.!?\n]{0,16}(?:92|USD|\$)/gi)) {
      violations.push("close-based-price-promoted-to-current-or-live");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:sell|出售|卖出)[^。.!?\n]{0,20}\d+\s*(?:shares|股))/gi)) {
      violations.push("unsupplied-share-count-invented");
    }
    return violations;
  }
  return undefined;
}
