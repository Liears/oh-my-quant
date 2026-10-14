import { affirmativeMethodClaimViolations, unquotedMethodProse } from "./performance-method-claims.ts";

/** For WhyJ's verified comparison/annual methods only: these compute return differences, not alpha. */
export function comparisonExcessClaimViolations(text: string): string[] {
  const code = "excess-return-labelled-alpha";
  const violations = new Set(affirmativeMethodClaimViolations(text, [{ code,
    pattern: /(?:超额收益(?:率)?|excess\s+return)\s*(?:是|为|等于|=|is|equals)\s*(?:风险调整(?:的)?\s*|risk[- ]adjusted\s+)?(?:alpha|α)|(?:alpha|α)\s*(?:[:：=]|为)?\s*[+\-−]?\d+(?:\.\d+)?\s*(?:pp|百分点|个百分点)/giu }]));
  let column: { index: number; count: number } | null = null;
  for (const line of unquotedMethodProse(text).split("\n")) {
    const row = (line.includes("|") ? line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|")
      : line.trim().split(/\s{2,}/u)).map(cell => cell.trim().replace(/^\*+|\*+$/gu, ""));
    const index = row.findIndex(cell => /^(?:(?:超额(?:收益)?|Excess(?:\s+return)?)\s*)?(?:α|alpha|风险调整\s*(?:α|alpha)|risk[- ]adjusted\s+alpha)$/iu.test(cell));
    if (index >= 0 && row.length > 1) column = { index, count: row.length };
    else if (!line.trim()) column = null;
    else if (column && row.length === column.count
      && /^[+\-−]?\d+(?:\.\d+)?\s*(?:[%％]|pp|百分点|个百分点)?$/iu.test(row[column.index]!)) violations.add(code);
  }
  return [...violations];
}
