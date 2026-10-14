const NEGATION = /(?:(?:不能|不可|不得|不应|不支持|不宣称|不将其称为|不(?:标注|称为|视为|认定为|作为|叫作)|并非|并不|不代表|不等于|不是|非|未提供|未供应|未|无|缺少|缺失|未知|是否|能否|尚待)|\b(?:cannot|can't|do not|does not|did not|whether|not|no|without|missing|unknown)\b)(?:[^。.!?\n]|\.(?=\d)){0,40}$/i;

export function hasUnsupportedClaim(answer: string, pattern: RegExp, negationInMatch = true): boolean {
  return [...answer.matchAll(pattern)].some(match => {
    if (inMissingList(answer, match.index ?? 0, match[0].length)) return false;
    const prefix = answer.slice(Math.max(0, (match.index ?? 0) - 64), match.index ?? 0)
      .split(/[;；]|[,，](?=\s*(?:已|现已|\b(?:it|this|the|we|I)\b))|\b(?:but|however|yet)\b|但是|但|然而|不过/iu).at(-1)!;
    // In "no alert exists", no belongs to the absence assertion, not its qualification.
    return !NEGATION.test(negationInMatch ? `${prefix}${match[0]}` : prefix);
  });
}

/** Long missing-input lists end at a sentence boundary or an independent assertion. */
function inMissingList(answer: string, index: number, length: number): boolean {
  const clause = answer.slice(0, index + length).split(/[;；。!?！？\n]|\.(?!\d)|\b(?:but|however|yet)\b|但是|但|然而|不过/iu).at(-1)!;
  const list = /^\s*(?:[-*]\s*)?(?:未使用|未提供|未供应|未检索|缺失(?:输入|证据)?|missing(?: inputs?| evidence)?|not (?:used|supplied|provided))\s*[:：]\s*(.*)$/iu.exec(clause);
  return !!list && !/(?:现已|已经|已)(?:涵盖|覆盖|提供|获取|具备|包括)|\b(?:covers?|includes?|is|are|has been|already)\b/iu.test(list[1]!);
}
