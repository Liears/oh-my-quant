/** Narrow regression check for the fixed factor/risk evaluation, not a semantic judge. */
export function knownFactorAnswerViolations(text: string): string[] {
  const topic = /均值回(?:归|复)|mean[-\s]?reversion/iu;
  const rejected = /(?:未|尚未|没有|尚无|缺少|无法|不能|不应|不可|不足以|不代表|不构成|不证明|不检验).{0,40}(?:均值回(?:归|复)|mean[-\s]?reversion)/iu;
  const untested = /(?:均值回(?:归|复)|mean[-\s]?reversion).{0,35}(?:未|未经|尚未|没有|尚无|待|需要|尚待|需)(?:被|经|进一步)?(?:检验|验证|证明|确认|测试)/iu;
  const pending = /(?:需|需要|待|尚待|应).{0,20}(?:检验|验证|测试).{0,20}(?:均值回(?:归|复)|mean[-\s]?reversion)/iu;
  const englishRejected = /(?:not|no|cannot|never|without).{0,35}mean[-\s]?reversion|mean[-\s]?reversion.{0,35}(?:not tested|untested|unverified|not established|requires? testing)/iu;
  return text.split(/(?:[。！？；\n]|但(?:是)?|然而|\bbut\b)/iu).some(clause => topic.test(clause) && !rejected.test(clause)
    && !untested.test(clause) && !pending.test(clause) && !englishRejected.test(clause))
    ? ["unsupported-mean-reversion-claim"] : [];
}

interface LatestClaim { value: number; percent: boolean; decimalPlaces: number }
const LATEST_LABEL = /\bLatest\b|最新(?:因子|动量)?值|动量最新值/giu;
const LATEST_VALUE = /^[\s*`|:：=（）()]*([+\-−]?(?:\d+(?:\.\d+)?|\.\d+))\s*([%％])?/u;
const LATEST_DATE = /^[\s*`|:：=（）()]*\d{4}[-/]\d{2}[-/]\d{2}(?!\d)/u;

function latestClaims(text: string): LatestClaim[] {
  const claims: LatestClaim[] = [];
  for (const line of text.split("\n")) for (const label of line.matchAll(LATEST_LABEL)) {
    const rest = line.slice(label.index! + label[0].length);
    if (LATEST_DATE.test(rest)) continue;
    const match = LATEST_VALUE.exec(rest);
    if (!match) continue;
    claims.push({ value: Number(match[1]!.replace("−", "-")), percent: !!match[2],
      decimalPlaces: match[1]!.split(".")[1]?.length ?? 0 });
  }
  return claims;
}

export function hasExplicitFactorLatestClaim(text: string): boolean {
  return latestClaims(text).length > 0;
}

/** Compare explicitly labelled Latest values at their stated precision; percentage form applies to return-like factors. */
export function factorLatestClaimViolations(text: string, evidence: { factor: string; latest: number }): string[] {
  const percentFactors = new Set(["momentum", "reversal", "volatility", "sma_deviation"]);
  for (const claim of latestClaims(text)) {
    if (claim.percent && !percentFactors.has(evidence.factor)) continue;
    const scale = claim.percent ? 100 : 1;
    const tolerance = Math.max(0.0000005, 0.5 * 10 ** -claim.decimalPlaces / scale) + 1e-12;
    if (!Number.isFinite(claim.value) || Math.abs(claim.value / scale - evidence.latest) > tolerance)
      return ["wrong-verified-factor-latest"];
  }
  return [];
}
