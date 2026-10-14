/** Finite, citation-bound distinction between unreported conditions and confirmed non-occurrence. */
export function newsAbsenceClaimViolations(text: string, paragraphs: ReadonlyMap<string, string>): string[] {
  const prose = text.replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`|“[^”\n]*”|"[^"\n]*"/gu, "")
    .split("\n").filter(line => !/^\s*>/u.test(line)).join("\n");
  for (const line of prose.split(/\n|[;；]|但是|然而|\bbut\b/iu)) {
    const assertion = /(?:条件(?:并|仍|尚)?未(?:发生|满足)|条件没有(?:发生|满足)|(?:the )?condition (?:did not|has not) (?:occur|happen|hold))/giu;
    for (const match of line.matchAll(assertion)) {
      const prefix = line.slice(0, match.index).split(/[。!?！？]/u).at(-1)!;
      if (/(?:不能|不可|无法|未报道|未报告|未证实|是否|如果|假如|错误|误称)|\b(?:cannot|not report|not confirm|whether|if|incorrect|wrong)\b/iu.test(prefix)) continue;
      const tail = line.slice(match.index! + match[0].length);
      if (/^[^\[]*(?:错误|不成立|未获证实|incorrect|wrong|unconfirmed)/iu.test(tail)) continue;
      const adjacent = /^[\s，,。.!?）)]*((?:\[[^\]\n]+\][\s，,。.!?]*)+)/u.exec(tail)?.[1] ?? "";
      const references = [...adjacent.matchAll(/\[(N-[^/\s\[\]]+)\/(p\d+(?:,\s*p\d+)*)\]/gu)];
      const cited = references.flatMap(ref => ref[2]!.split(",").map(id => paragraphs.get(`${ref[1]}/${id.trim()}`) ?? ""));
      const unknown = /(?:does not|did not|has not) report(?:ed)? that the condition (?:occurred|was met)|未(?:报道|报告|披露)(?:该)?条件(?:已经|已)?(?:发生|满足)/iu;
      const confirmedAbsent = /(?:the )?condition (?:did not|has not) (?:occur|happen|hold)|(?:确认|证实)(?:该)?条件(?:并)?未(?:发生|满足)/iu;
      if (cited.some(paragraph => unknown.test(paragraph)) && !cited.some(paragraph => confirmedAbsent.test(paragraph))) {
        return ["unreported-condition-promoted-to-nonoccurrence"];
      }
    }
  }
  return [];
}
