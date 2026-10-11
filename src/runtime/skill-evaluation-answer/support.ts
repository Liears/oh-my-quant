const NEGATION = /(?:(?:不能|不可|不得|不应|不(?:标注|称为|视为|认定为|作为|叫作)|并非|并不|不代表|不等于|不是|非|未提供|未供应|未|无|缺少|缺失|未知|是否|能否|尚待)|\b(?:cannot|can't|do not|does not|did not|whether|not|no|without|missing|unknown)\b)[^。.!?\n]{0,40}$/i;

export function hasUnsupportedClaim(answer: string, pattern: RegExp): boolean {
  return [...answer.matchAll(pattern)].some(match => {
    const prefix = answer.slice(Math.max(0, (match.index ?? 0) - 64), match.index ?? 0);
    return !NEGATION.test(`${prefix}${match[0]}`);
  });
}
