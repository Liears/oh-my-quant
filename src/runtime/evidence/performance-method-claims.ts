/** Exclude quoted counterexamples from finite method assertions. */
export function unquotedMethodProse(text: string): string {
  return text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/gu, "")
    .replace(/`[^`\n]*`|“[^”\n]*”|‘[^’\n]*’|"[^"\n]*"|'[^'\n]*'/gu, "")
    .split("\n").filter(line => !/^\s*>/u.test(line)).join("\n");
}

/** Finite affirmative definition checks; quoted examples and qualified claims are not graded. */
export function affirmativeMethodClaimViolations(text: string, definitions: readonly { code: string; pattern: RegExp }[]): string[] {
  const prose = unquotedMethodProse(text);
  const violations = new Set<string>();
  for (const clause of prose.split(/[。；;!?！？\n]|\bbut\b|但是|但|然而/iu)) {
    for (const { code, pattern } of definitions) for (const match of clause.matchAll(pattern)) {
      const prefix = clause.slice(0, match.index);
      if (/(?:错误|误称|有人|如果|假如|若|并非|不是)|\b(?:if|incorrect|wrong|mistaken|claimed)\b/iu.test(prefix)) continue;
      if (/(?:并非|不是|不(?:是)?(?:源于|取决于))|\b(?:not because|not due to|isn't caused by)\b/iu.test(match[0])) continue;
      if (/(?:不正确|不成立|错误(?:翻译|表述|定义))|\b(?:incorrect|wrong)\b/iu.test(clause.slice(match.index! + match[0].length))) continue;
      violations.add(code);
    }
  }
  return [...violations];
}

/** These two definitions do not depend on selecting a particular asset or archived task. */
export function performanceMethodClaimViolations(text: string): string[] {
  return affirmativeMethodClaimViolations(text, [
    { code: "wrong-drawdown-period-method", pattern: /(?:最大回撤率?|Max(?:imum)?\s+(?:drawdown|DD))\s*(?:均为|是|为|等于|is|equals)\s*(?:a\s+|the\s+)?(?:单期|单日|日|single[- ]period|one[- ]period|daily)[^。;!?\n]{0,12}(?:收益(?:率)?|returns?)/giu },
    { code: "wrong-sharpe-zero-drawdown-causality", pattern: /(?:Sharpe(?:\s+ratio)?|夏普(?:比率)?)[^。;!?\n]{0,24}(?:源于|因为|由于|(?:is\s+)?(?:caused\s+by|due\s+to|comes\s+from)|because(?:\s+of)?)[^。;!?\n]{0,24}(?:零(?:观察|观测)?回撤|(?:观察|观测)?回撤(?:为|是|等于)?(?:零|0\s*[%％]?)|zero(?:\s+observed)?(?:\s+maximum)?\s+drawdown|(?:maximum\s+)?drawdown\s+is\s+zero)/giu },
  ]);
}
