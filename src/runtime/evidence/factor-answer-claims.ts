import { unquotedMethodProse } from "./performance-method-claims.ts";

/** Narrow regression check for the fixed factor/risk evaluation, not a semantic judge. */
export function knownFactorAnswerViolations(text: string): string[] {
  const topic = /均值回(?:归|复)|mean[-\s]?reversion/iu;
  const rejected = /(?:未|尚未|没有|尚无|缺少|无法|不能|不应|不可|不足以|不代表|不构成|不证明|不检验|不测试|不预测).{0,40}(?:均值回(?:归|复)|mean[-\s]?reversion)/iu;
  const untested = /(?:均值回(?:归|复)|mean[-\s]?reversion).{0,35}(?:未|未经|尚未|没有|尚无|待|需要|尚待|需)(?:被|经|进一步)?(?:检验|验证|证明|确认|测试)/iu;
  const pending = /(?:需|需要|待|尚待|应).{0,20}(?:检验|验证|测试).{0,20}(?:均值回(?:归|复)|mean[-\s]?reversion)/iu;
  const englishRejected = /(?:not|no|cannot|never|without).{0,35}mean[-\s]?reversion|mean[-\s]?reversion.{0,35}(?:not tested|untested|unverified|not established|requires? testing)/iu;
  const meanReversion = text.split(/(?:[。！？；\n]|但(?:是)?|然而|\bbut\b)/iu).some(clause => topic.test(clause) && !rejected.test(clause)
    && !untested.test(clause) && !pending.test(clause) && !englishRejected.test(clause))
    ? ["unsupported-mean-reversion-claim"] : [];
  return [...meanReversion, ...annualizationProhibitionViolations(text)];
}

/** An unannualized factor does not prohibit a separately justified square-root-frequency conversion. */
function annualizationProhibitionViolations(text: string): string[] {
  const topic = /\bvolatility\b|(?:daily|factor)\s+(?:volatility|(?:sample\s+)?standard\s+deviation)|因子波动率|日(?:收益率的)?(?:样本)?标准差/iu;
  const prohibition = /(?:不能|不可|无法|禁止|不允许)(?:被|进行|再)?\s*年化|(?:不能|不可|无法|禁止|不允许)[^。；;\n]{0,16}乘(?:以)?[^。；;\n]{0,18}(?:sqrt\s*\(|√|平方根|频率因子)[^。；;\n]{0,28}年化|(?:cannot|can never|can't|must not)\s+(?:be\s+)?annuali[sz]|(?:cannot|can never|can't|must not)[^.;\n]{0,35}(?:multiplied|multiply)[^.;\n]{0,16}(?:square root|sqrt|√)[^.;\n]{0,30}annuali[sz]/iu;
  const qualified = /(?:频率|时间间隔|周期)[^，,；;。\n]{0,12}(?:未知|不明|未验证|不规则)|(?:未|没有|缺少)[^，,；;。\n]{0,12}(?:验证|确认)[^，,；;。\n]{0,12}频率|自相关|irregular|autocorrelation|(?:unknown|unverified)\s+(?:observation\s+)?frequency|without[^.;\n]{0,45}(?:frequency|assumptions?)/iu;
  for (const line of unquotedMethodProse(text).split(/\n|但是|但|然而|\bbut\b/iu)) {
    if (!topic.test(line) || qualified.test(line)) continue;
    for (const clause of line.split(/[。！？；;]|(?<!\d)\.(?!\d)/u)) {
      const match = prohibition.exec(clause);
      if (!match) continue;
      if (!topic.test(clause) && /\brsi\b|volume_ratio|sma_deviation|momentum|reversal|量比/iu.test(clause)) continue;
      if (/(?:错误|误称|有人声称)|\b(?:incorrect|wrong|mistaken|claimed)\b/iu.test(clause)) continue;
      return ["unsupported-factor-annualization-prohibition"];
    }
  }
  return [];
}

export { factorLatestClaimViolations, hasExplicitFactorLatestClaim } from "./factor-latest-claims.ts";
