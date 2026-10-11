/** Only explicit portfolio metric claims are compared with an already verified result. */
export interface VerifiedPortfolioAnswerMetrics {
  groups: readonly [{ name: string; totalReturn: number; maxDrawdown: number }, { name: string; totalReturn: number; maxDrawdown: number }];
}

const METRIC_LABEL = /累计收益率?|总收益率?|总回报|Total\s+return|最大回撤率?|Max(?:imum)?\s+drawdown|Max\s*DD|\bTR\b|\bDD\b/giu;
const PERCENT = /^\s*(?:(?:[:：=]|为|约为|约|达到)\s*)?[（(]?\s*([+\-−]?\d+(?:\.\d+)?)\s*[%％]/u;

function metricKind(label: string): "totalReturn" | "maxDrawdown" {
  return /回撤|drawdown|\bDD\b/iu.test(label) ? "maxDrawdown" : "totalReturn";
}

function wrong(reported: number, expected: number, metric: "totalReturn" | "maxDrawdown"): boolean {
  const actual = metric === "maxDrawdown" ? Math.abs(reported) : reported;
  const target = metric === "maxDrawdown" ? Math.abs(expected * 100) : expected * 100;
  return !Number.isFinite(actual) || Math.abs(actual - target) > 0.05;
}

function groupIndex(text: string, evidence: VerifiedPortfolioAnswerMetrics): 0 | 1 | null {
  const value = text.replace(/^[*`\s]+|[*`\s]+$/gu, "");
  for (const index of [0, 1] as const) {
    const name = evidence.groups[index].name;
    if (value === name || value.startsWith(`${name} (`) || value.startsWith(`${name}（`) || value.startsWith(`${name}/`)
      || new RegExp(`^(?:Portfolio|组合)\\s*${index === 0 ? "A" : "B"}(?:$|\\s|[（(])`, "iu").test(value)
      || value === `${index === 0 ? "A" : "B"}组`) return index;
  }
  return null;
}

function cells(line: string): string[] {
  return (line.includes("|") ? line.split("|") : line.trim().split(/\s{2,}/u)).map(cell => cell.trim()).filter(Boolean);
}

/** Bounded check: labelled percentages and aligned comparison rows, not free-form semantic grading. */
export function portfolioMetricClaimViolations(text: string, evidence: VerifiedPortfolioAnswerMetrics): string[] {
  const violations = new Set<string>();
  let columns: { totalReturn: number; maxDrawdown: number; count: number } | null = null;
  const aliases = evidence.groups.flatMap((group, index) => [group.name, `Portfolio ${index === 0 ? "A" : "B"}`,
    `组合 ${index === 0 ? "A" : "B"}`, `组合${index === 0 ? "A" : "B"}`, `${index === 0 ? "A" : "B"}组`].map(alias => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return { index: index as 0 | 1, pattern: new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu") };
  }));
  const check = (index: 0 | 1, metric: "totalReturn" | "maxDrawdown", value: string) => {
    const percent = PERCENT.exec(value);
    if (!percent) return;
    const reported = Number(percent[1]!.replace("−", "-"));
    if (wrong(reported, evidence.groups[index][metric], metric))
      violations.add(`wrong-verified-portfolio-${index === 0 ? "a" : "b"}-${metric === "totalReturn" ? "return" : "drawdown"}`);
  };
  for (const line of text.split("\n")) {
    const row = cells(line);
    const returnColumn = row.findIndex(cell => /^(?:累计收益率?|总收益率?|总回报|Total\s+return|TR)$/iu.test(cell));
    const drawdownColumn = row.findIndex(cell => /^(?:最大回撤率?(?:\s*DD)?|Max(?:imum)?\s+drawdown|Max\s*DD|DD)$/iu.test(cell));
    if (returnColumn >= 0 && drawdownColumn >= 0) columns = { totalReturn: returnColumn, maxDrawdown: drawdownColumn, count: row.length };
    else if (!line.trim()) columns = null;
    else if (columns && row.length >= columns.count) {
      const offset = row.length - columns.count;
      const index = row.slice(0, Math.min(columns.totalReturn, columns.maxDrawdown) + offset)
        .map(cell => groupIndex(cell, evidence)).find(item => item !== null);
      if (index !== undefined) {
        check(index, "totalReturn", row[columns.totalReturn + offset]!);
        check(index, "maxDrawdown", row[columns.maxDrawdown + offset]!);
      }
    }
    const mentions = aliases.flatMap(alias => [...line.matchAll(alias.pattern)]
      .map(match => ({ index: alias.index, start: match.index!, end: match.index! + match[0].length })))
      .sort((a, b) => a.start - b.start || b.end - a.end)
      .filter((item, position, all) => position === 0 || item.start !== all[position - 1]!.start);
    for (let i = 0; i < mentions.length; i++) {
      const mention = mentions[i]!;
      const segment = line.slice(mention.end, mentions[i + 1]?.start ?? line.length);
      const labels = [...segment.matchAll(METRIC_LABEL)];
      for (let j = 0; j < labels.length; j++) {
        const label = labels[j]!, kind = metricKind(label[0]);
        check(mention.index, kind, segment.slice(label.index! + label[0].length, labels[j + 1]?.index ?? segment.length).slice(0, 80));
      }
    }
  }
  return [...violations];
}
