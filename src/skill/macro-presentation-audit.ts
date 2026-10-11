/** Checks the pinned macro report's reader-facing claims against its JSON receipt. */
const DASHBOARD = [
  { key: "concentration", label: "Market Concentration (RSP/SPY)", weight: 25 },
  { key: "yield_curve", label: "Yield Curve (10Y-2Y)", weight: 20 },
  { key: "credit_conditions", label: "Credit Conditions (HYG/LQD)", weight: 15 },
  { key: "size_factor", label: "Size Factor (IWM/SPY)", weight: 15 },
  { key: "equity_bond", label: "Equity-Bond (SPY/TLT)", weight: 15 },
  { key: "sector_rotation", label: "Sector Rotation (XLY/XLP)", weight: 10 },
] as const;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function matchingRows(markdown: string, label: string): string[] {
  return markdown.split(/\r?\n/u).filter(line => line.startsWith("|") && line.split("|")[1]?.trim() === `**${label}**`);
}

function cells(line: string): string[] {
  return line.split("|").slice(1, -1).map(cell => cell.trim());
}

/** Replays receipts written before the dashboard checks were added. */
export function auditMacroPresentationV1(raw: unknown, markdown: string): string[] {
  const issues: string[] = [], report = object(raw), metadata = object(report?.metadata), composite = object(report?.composite);
  const sourceLine = /^\*\*Data Source:\*\*\s*(.+)$/mu.exec(markdown)?.[1];
  if (!sourceLine || metadata?.data_mode === "yfinance_only" && !/\byfinance\b/iu.test(sourceLine))
    issues.push("markdown-source-label-conflicts-with-json");
  if (typeof composite?.composite_score !== "number" || typeof composite.zone !== "string"
    || !markdown.includes(`**${composite.composite_score}/100**`) || !markdown.includes(composite.zone))
    issues.push("markdown-score-or-zone-mismatch");
  return issues;
}

/** Only validates visible labels and numbers; narrative guidance needs separate review. */
export function auditMacroPresentation(raw: unknown, markdown: string): string[] {
  const issues: string[] = [], report = object(raw), metadata = object(report?.metadata), composite = object(report?.composite);
  const components = object(report?.components), quality = object(composite?.data_quality);
  const sources = [...markdown.matchAll(/^\*\*Data Source:\*\*\s*(.+)$/gmu)].map(match => match[1]!.trim());
  if (sources.length !== 1 || metadata?.data_mode === "yfinance_only"
    && (!/\byfinance\b/iu.test(sources[0] ?? "") || /\bFMP\b/iu.test(sources[0] ?? "")))
    issues.push("markdown-source-label-conflicts-with-json");

  const scores = matchingRows(markdown, "Transition Score"), zones = matchingRows(markdown, "Signal Zone");
  const visibleScores = [...(cells(scores[0] ?? "")[1] ?? "").matchAll(/\*\*(-?\d+(?:\.\d+)?)\/100\*\*/gu)];
  if (scores.length !== 1 || zones.length !== 1 || typeof composite?.composite_score !== "number"
    || typeof composite.zone !== "string"
    || visibleScores.length !== 1 || Number(visibleScores[0]?.[1]) !== composite.composite_score
    || cells(zones[0]!)[1] !== composite.zone)
    issues.push("markdown-score-or-zone-mismatch");

  const signaling = matchingRows(markdown, "Components Signaling"), dataQuality = matchingRows(markdown, "Data Quality");
  if (signaling.length !== 1 || dataQuality.length !== 1 || !quality
    || cells(signaling[0]!)[1] !== `${composite?.signaling_components}/${quality.total_components}`
    || !cells(dataQuality[0]!)[1]?.includes(`(${quality.available_count}/${quality.total_components} components)`))
    issues.push("markdown-data-quality-mismatch");

  const section = /^## 2\. Transition Signal Dashboard\s*$([\s\S]*?)^## 3\./mu.exec(markdown)?.[1];
  const rows = section?.split(/\r?\n/u).filter(line => /^\|\s*\d+\s*\|/u.test(line)).map(cells) ?? [];
  if (rows.length !== DASHBOARD.length || DASHBOARD.some((item, index) => {
    const row = rows[index], component = object(components?.[item.key]);
    const score = /(?:^|\s)(\d+(?:\.\d+)?)\s*$/u.exec(row?.[3] ?? "")?.[1];
    return !row || row[0] !== String(index + 1) || row[1] !== `**${item.label}**`
      || row[2] !== `${item.weight}%` || score === undefined || Number(score) !== component?.score;
  })) issues.push("markdown-component-dashboard-mismatch");
  return issues;
}
