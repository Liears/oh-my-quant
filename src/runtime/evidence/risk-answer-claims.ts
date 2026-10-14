import { affirmativeMethodClaimViolations, performanceMethodClaimViolations } from "./performance-method-claims.ts";

/** Only explicitly labelled percentages/observation counts of one verified risk calculation are compared. */
export interface VerifiedRiskAnswerMetrics {
  symbol: string;
  annualVolatility: number;
  downsideVolatility: number;
  var95: number;
  cvar95: number;
  maxDrawdown: number;
  drawdownDuration: number;
}

type Metric = keyof Omit<VerifiedRiskAnswerMetrics, "symbol">;
const LABEL = /(?:年化)?下行(?:(?:年化)?波动率?|偏差)|Downside\s+(?:annual(?:ized)?\s+)?(?:vol(?:atility)?|deviation)|(?<![A-Za-z])C?VaR\s*95\s*[%％]?(?:\s*[(（]\s*(?:hist(?:orical)?|历史|单期|per-period)\s*[)）])?|回撤持续(?:时间|天数|期数|期)?|Drawdown\s+duration|Longest\s+underwater|Max(?:imum)?\s+DD\s+(?:days|duration)|年化波动率?|Annual\s+vol(?:atility)?|最大回撤率?|Max(?:imum)?\s+(?:drawdown|DD)/giu;
const PERCENT = /^[\s*|:：=（(]*(?:为|约为|约|达到)?[\s*|:：=（(]*([+\-−]?\d+(?:\.\d+)?)\s*[%％]/u;
const DURATION = /^[\s*|:：=（(]*(?:为|约为|约|达到)?[\s*|:：=（(]*(\d+)(?![.\d%％])(?:\s*(?:个?(?:观察|观测)?期|(?:observed\s+)?periods?)(?=$|\s|[，,。.;；|()（）*])|(?=\s*(?:$|[，,。.;；|)）*])))/iu;
const CODES: Record<Metric, string> = {
  annualVolatility: "wrong-verified-annual-volatility", downsideVolatility: "wrong-verified-downside-volatility",
  var95: "wrong-verified-var95", cvar95: "wrong-verified-cvar95", maxDrawdown: "wrong-verified-risk-drawdown",
  drawdownDuration: "wrong-verified-drawdown-duration",
};
export const RISK_ANSWER_VIOLATION_LABELS: Record<string, string> = {
  "wrong-verified-annual-volatility": "年化波动率", "wrong-verified-downside-volatility": "下行波动率",
  "wrong-verified-var95": "VaR 95%", "wrong-verified-cvar95": "CVaR 95%",
  "wrong-verified-risk-drawdown": "最大回撤", "wrong-verified-drawdown-duration": "回撤持续期",
  "wrong-verified-downside-method": "下行偏差计算口径",
  "wrong-verified-annual-volatility-method": "年化波动率计算口径",
  "wrong-verified-risk-annualization": "两项波动率的年化口径",
  "wrong-drawdown-period-method": "最大回撤计算口径",
  "wrong-sharpe-zero-drawdown-causality": "Sharpe 计算口径",
};

/** Narrow affirmative contradictions of this tool's sample variance and zero-target/full-N methods.
 * This is not a general semantic judge or a claim about every external risk definition. */
export function riskMethodClaimViolations(text: string): string[] {
  const definitions = [
    { code: "wrong-verified-risk-annualization", pattern: /(?:仅|只有|唯有)\s*年化波动率?\s*(?:按\s*(?:sqrt\s*[(（]\s*252\s*[)）]|√\s*252)\s*)?(?:被)?年化|(?:Only\s+(?:the\s+)?annual\s+vol(?:atility)?\s+is\s+annuali[sz]ed)|(?:下行(?:波动率?|偏差)\s*(?:不年化|未年化|无需年化)|Downside\s+(?:vol(?:atility)?|deviation)\s+is\s+not\s+annuali[sz]ed)/giu },
    { code: "wrong-verified-annual-volatility-method", pattern: /(?:年化波动率?|Annual\s+vol(?:atility)?)\s*(?:=|为|是|等于|is|equals)\s*(?:sqrt|√)\s*[(（]\s*(?:样本方差|sample\s+variance)\s*[/／÷]\s*[(（]?\s*N\s*[-−–]\s*1/giu },
    { code: "wrong-verified-downside-method", pattern: /(?:下行(?:波动率?|偏差)\s*(?:是|为|等于|定义为|=)\s*(?:(?:日|负)?收益(?:率)?(?:的)?|日)?(?:样本)?标准差|Downside\s+(?:vol(?:atility)?|deviation)\s+(?:is|equals|is\s+defined\s+as)\s+(?:the\s+)?(?:daily\s+|negative\s+|returns?\s+)*standard\s+deviation)/giu },
  ];
  if (/(?:下行(?:波动率?|偏差)|Downside\s+(?:vol(?:atility)?|deviation))/iu.test(text)) {
    definitions.push({ code: "wrong-verified-downside-method", pattern: /两项波动率?\s*(?:均为|都是|为|是)\s*(?:日收益(?:率)?(?:的)?|收益(?:率)?(?:的)?)?(?:样本)?标准差/giu });
  }
  return [...affirmativeMethodClaimViolations(text, definitions), ...performanceMethodClaimViolations(text)];
}

export function hasRiskMetricLabel(text: string): boolean {
  return new RegExp(LABEL.source, "iu").test(text);
}

function kind(label: string): Metric {
  if (/下行|Downside/iu.test(label)) return "downsideVolatility";
  if (/CVaR/iu.test(label)) return "cvar95";
  if (/VaR/iu.test(label)) return "var95";
  if (/持续|duration|days|underwater/iu.test(label)) return "drawdownDuration";
  return /回撤|drawdown|\bDD\b/iu.test(label) ? "maxDrawdown" : "annualVolatility";
}

function wrong(reported: number, expected: number, metric: Metric): boolean {
  if (metric === "drawdownDuration") return reported !== expected;
  const actual = metric === "maxDrawdown" ? Math.abs(reported) : reported;
  const target = metric === "maxDrawdown" ? Math.abs(expected * 100) : expected * 100;
  return !Number.isFinite(actual) || Math.abs(actual - target) > 0.05;
}

export function parseRiskMetricClaims(text: string, symbol: string): Array<{ metric: Metric; value: number }> {
  const claims: Array<{ metric: Metric; value: number }> = [];
  const check = (metric: Metric, value: string) => {
    const match = (metric === "drawdownDuration" ? DURATION : PERCENT).exec(value);
    if (!match) return;
    claims.push({ metric, value: Number(match[1]!.replace("−", "-")) });
  };
  let columns: { metrics: Array<{ metric: Metric; index: number }>; count: number } | null = null;
  for (const line of text.split("\n")) {
    const row = line.includes("|") ? line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim()) : [];
    const headers = row.flatMap((cell, index) => {
      const match = cell.match(new RegExp(`^(?:${LABEL.source})$`, "iu"));
      return match ? [{ metric: kind(match[0]), index }] : [];
    });
    if (headers.length) columns = { metrics: headers, count: row.length };
    else if (!line.trim()) columns = null;
    else if (columns && row.length === columns.count
      && row.some(cell => cell === symbol || cell.startsWith(symbol + " "))) {
      for (const { metric, index } of columns.metrics) check(metric, row[index]!);
    }
    const labels = [...line.matchAll(LABEL)];
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index]!;
      check(kind(label[0]), line.slice(label.index! + label[0].length, labels[index + 1]?.index ?? line.length).slice(0, 60));
    }
  }
  return claims;
}

export function riskMetricClaimViolations(text: string, evidence: VerifiedRiskAnswerMetrics): string[] {
  return [...new Set(parseRiskMetricClaims(text, evidence.symbol)
    .filter(claim => wrong(claim.value, evidence[claim.metric], claim.metric)).map(claim => CODES[claim.metric]))];
}
