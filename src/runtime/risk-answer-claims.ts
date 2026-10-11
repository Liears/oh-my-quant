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
const LABEL = /(?:年化)?下行(?:年化)?波动率?|Downside\s+(?:annual(?:ized)?\s+)?vol(?:atility)?|(?<![A-Za-z])CVaR\s*95\s*[%％]?|(?<![A-Za-z])VaR\s*95\s*[%％]?(?:\s*[(（]\s*(?:hist(?:orical)?|历史)\s*[)）])?|回撤持续(?:时间|天数|期数|期)?|Drawdown\s+duration|Max(?:imum)?\s+DD\s+(?:days|duration)|年化波动率?|Annual\s+vol(?:atility)?|最大回撤率?|Max(?:imum)?\s+(?:drawdown|DD)/giu;
const PERCENT = /^[\s*|:：=（(]*(?:为|约为|约|达到)?[\s*|:：=（(]*([+\-−]?\d+(?:\.\d+)?)\s*[%％]/u;
const DURATION = /^[\s*|:：=（(]*(?:为|约为|约|达到)?[\s*|:：=（(]*(\d+)(?![.\d%％])(?:\s*(?:个?(?:观察|观测)?期|(?:observed\s+)?periods?))?(?=\s*(?:$|[，,。.;；|)）*]))/iu;
const CODES: Record<Metric, string> = {
  annualVolatility: "wrong-verified-annual-volatility", downsideVolatility: "wrong-verified-downside-volatility",
  var95: "wrong-verified-var95", cvar95: "wrong-verified-cvar95", maxDrawdown: "wrong-verified-risk-drawdown",
  drawdownDuration: "wrong-verified-drawdown-duration",
};
export const RISK_ANSWER_VIOLATION_LABELS: Record<string, string> = {
  "wrong-verified-annual-volatility": "年化波动率", "wrong-verified-downside-volatility": "下行波动率",
  "wrong-verified-var95": "VaR 95%", "wrong-verified-cvar95": "CVaR 95%",
  "wrong-verified-risk-drawdown": "最大回撤", "wrong-verified-drawdown-duration": "回撤持续期",
};

export function hasRiskMetricLabel(text: string): boolean {
  return new RegExp(LABEL.source, "iu").test(text);
}

function kind(label: string): Metric {
  if (/下行|Downside/iu.test(label)) return "downsideVolatility";
  if (/CVaR/iu.test(label)) return "cvar95";
  if (/VaR/iu.test(label)) return "var95";
  if (/持续|duration|days/iu.test(label)) return "drawdownDuration";
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
