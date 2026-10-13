/** Known, definite claim contradictions from the fixed synthetic fund evaluation.
 * This is a regression gate, not a general natural-language correctness judge. */
export interface VerifiedFundAnswerMetrics {
  principalReturn: number;
  timeWeightedReturn: number;
  maximumDrawdownTwr: number;
}

const METRIC_LABELS = /Principal\s+return|本金收益率|本金收益|Time[- ]weighted\s+return|时间加权收益率|TWR(?!\s*[)）])|(?:Maximum\s+drawdown|MaxDD|最大回撤)(?:\s*[(（]\s*TWR\s*(?:口径\s*)?[)）])?|XIRR|Annualized\s+return|年化收益率/giu;
const PERCENT = /([+\-−]?\d+(?:[.]\d+)?)\s*[%％]/u;

function metricCode(label: string): keyof VerifiedFundAnswerMetrics | null {
  if (/Principal|本金收益/iu.test(label)) return "principalReturn";
  if (/Maximum|MaxDD|最大回撤/iu.test(label)) return "maximumDrawdownTwr";
  if (/XIRR|Annualized|年化收益率/iu.test(label)) return null;
  return "timeWeightedReturn";
}

/** Check only explicit metric-label percentages against a verified tool receipt. */
export function verifiedFundMetricClaimViolations(text: string, evidence: VerifiedFundAnswerMetrics): string[] {
  const codes: string[] = [];
  const name: Record<keyof VerifiedFundAnswerMetrics, string> = {
    principalReturn: "wrong-verified-principal-return",
    timeWeightedReturn: "wrong-verified-time-weighted-return",
    maximumDrawdownTwr: "wrong-verified-twr-drawdown",
  };
  for (const line of text.split(/[\n。；;]/u)) {
    const labels = [...line.matchAll(METRIC_LABELS)];
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index]!, kind = metricCode(label[0]);
      if (!kind) continue;
      const following = line.slice(label.index! + label[0].length, labels[index + 1]?.index ?? line.length).slice(0, 80);
      const percent = PERCENT.exec(following);
      if (!percent) continue;
      const reported = Number(percent[1]!.replace("−", "-"));
      const expected = evidence[kind] * 100;
      if (Number.isFinite(reported) && Number.isFinite(expected) && Math.abs(reported - expected) > 0.01 && !codes.includes(name[kind]))
        codes.push(name[kind]);
    }
  }
  return codes;
}

/** Check the arithmetic explicitly printed in the same principal-return line. */
export function principalFormulaClaimViolations(text: string): string[] {
  const formula = /(?:Principal return|本金收益率)[^\n]{0,100}?(-?\d+(?:[.]\d+)?)\s*%[^\n]{0,100}?(?:期末|末期|最终)(?:模拟)?市值\s*(\d+(?:[.]\d+)?)\s*[−-]\s*(?:累计)?(?:投入|本金)\s*(\d+(?:[.]\d+)?)/iu.exec(text);
  if (!formula) return [];
  const reported = Number(formula[1]), finalValue = Number(formula[2]), invested = Number(formula[3]);
  return Number.isFinite(reported) && Number.isFinite(finalValue) && Number.isFinite(invested)
    && invested > 0 && Math.abs((finalValue / invested - 1) * 100 - reported) > 0.01
    ? ["wrong-fixed-principal-formula"] : [];
}

export function knownFundAnswerViolations(text: string, evidence?: VerifiedFundAnswerMetrics): string[] {
  const issues: string[] = [];
  if (/(?:与|和)(?:该)?(?:基金|净值|标的)(?:本身)?(?:表现|路径|价格)?(?:完全)?无关/u.test(text)
    || /(?:is|remains)\s+independent\s+of\s+(?:the\s+)?fund(?:'s)?\s+(?:performance|NAV)/iu.test(text))
    issues.push("principal/fund-independence-claim");
  const directComparison = /(?:可|可以|能够)?(?:与|和).{0,28}(?:基金|基准).{0,12}直接(?:对比|比较)|directly\s+comparable\s+(?:with|to)\s+(?:other\s+)?(?:funds?|benchmarks?)/iu;
  const rejectedComparison = /(?:不能|不可|不宜|不应|无法)[^。；\n]{0,42}(?:基金|基准)[^。；\n]{0,16}直接(?:对比|比较)|直接(?:对比|比较)(?:会|将|可能)?(?:误导|不合理|无效|不成立|不可取|不宜)/u;
  const aligned = /同一(?:估值)?(?:窗口|区间|期间)|matching\s+(?:valuation\s+)?period/iu.test(text)
    && /同(?:一)?币种|same\s+currency/iu.test(text)
    && /(?:费率|费用|手续费).*(?:一致|相同)|consistent\s+fee/iu.test(text)
    && /(?:分红|分配).*(?:一致|相同)|consistent\s+distribution/iu.test(text);
  if (!aligned && text.split(/[。；\n]/u).some(clause => directComparison.test(clause) && !rejectedComparison.test(clause)))
    issues.push("unaligned-direct-twr-comparison");
  if (/A\s*股(?:类)?开放式基金|A\s*股基金|A-share\s+(?:open-end\s+)?fund/iu.test(text)) issues.push("unsupported-a-share-fund-classification");
  if (/(?:回撤|drawdown).{0,32}无统计意义/iu.test(text)) issues.push("unsupported-zero-statistical-meaning");
  if (/(?:两(?:笔|次)(?:申购|买入)).{0,24}(?:成本|价格|NAV).{0,12}(?:均为|都为|都是|均以|都以).{0,12}0[.]6000/iu.test(text)
    || /both\s+purchases?\s+(?:were|are|at|cost)\s+0[.]6000/iu.test(text))
    issues.push("blended-cost-as-each-purchase-nav");
  if (/(?:本例|此次|该|this\s+case)?.{0,16}29\s*(?:天|days?)(?:的)?(?:窗口|持有|区间|window|holding|period)/iu.test(text))
    issues.push("wrong-fixed-window-day-count");
  issues.push(...principalFormulaClaimViolations(text));
  if (evidence) issues.push(...verifiedFundMetricClaimViolations(text, evidence));
  return issues;
}
