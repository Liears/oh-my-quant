import { unquotedMethodProse } from "./performance-method-claims.ts";

/** Read only explicit symbol/percent pairs in a supplied portfolio description. Ambiguity abstains. */
export function suppliedPortfolioWeights(request: string): ReadonlyMap<string, number> {
  const weights = new Map<string, number>(), ambiguous = new Set<string>();
  if (!/portfolio|组合|权重|weights/iu.test(request)) return weights;
  for (const match of request.matchAll(/\b([A-Z][A-Z0-9.\-]{0,15})\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*[%％]/gu)) {
    const name = match[1]!, weight = Number(match[2]);
    if (weight > 100 || weights.has(name) && weights.get(name) !== weight) ambiguous.add(name);
    weights.set(name, weight);
  }
  for (const name of ambiguous) weights.delete(name);
  return weights;
}

/** Check explicit named weight sums, never infer a return or ETF look-through exposure. */
export function portfolioWeightClaimViolations(answer: string, request: string): string[] {
  const weights = suppliedPortfolioWeights(request);
  if (weights.size < 2) return [];
  const prose = unquotedMethodProse(answer).replace(/\*\*/gu, "");
  for (const clause of prose.split(/[。；;!?！？\n]|\b(?:but|however)\b|但是|然而/iu)) {
    if (/(?:不能|不可|不是|并非|错误|误称|如果|假如)|\b(?:not|incorrect|wrong|if)\b/iu.test(clause)) continue;
    const sum = /\b[A-Z][A-Z0-9.\-]{0,15}(?:\s*[+＋]\s*[A-Z][A-Z0-9.\-]{0,15})+/gu;
    for (const match of clause.matchAll(sum)) {
      const names = match[0].split(/[+＋]/u).map(name => name.trim());
      if (new Set(names).size !== names.length || names.some(name => !weights.has(name))) continue;
      const before = clause.slice(0, match.index), after = clause.slice(match.index! + match[0].length);
      // Either "SPY+XLE = 65%" or "65% 与股票风险挂钩（SPY+XLE）".
      const suffix = /^\s*[)）]?\s*(?:(?:合计|权重|占比|共|为|是|=|:|：|is|total|weight)\s*)+(\d+(?:\.\d+)?)\s*[%％]/iu.exec(after);
      const prefix = /(\d+(?:\.\d+)?)\s*[%％][^\d%％+＋]{0,32}[(（]\s*$/u.exec(before);
      const value = suffix?.[1] ?? prefix?.[1];
      if (value === undefined) continue;
      const expected = names.reduce((total, name) => total + weights.get(name)!, 0);
      const decimals = value.split(".")[1]?.length ?? 0;
      if (Math.abs(Number(value) - expected) > 0.5 * 10 ** -decimals + 1e-9) return ["wrong-supplied-weight-sum"];
    }
  }
  return [];
}
