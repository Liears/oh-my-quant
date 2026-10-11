type JsonRecord = Record<string, unknown>;
const object = (value: unknown): JsonRecord | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const close = (actual: unknown, expected: number): boolean => {
  const value = number(actual);
  return value !== null && Number.isFinite(expected) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
    && Math.abs(expected) <= Number.MAX_SAFE_INTEGER && Math.abs(value - expected) <= 1e-7;
};
const round2 = (value: number): number => Number(value.toFixed(2));

function floorShares(value: number, fractional: boolean, precision: number): number {
  if (!fractional) return Math.trunc(value);
  const scale = 10 ** precision;
  return Math.floor((value + 1e-12) * scale) / scale;
}

function calculation(raw: unknown, method: string): JsonRecord | null {
  const value = object(raw);
  return value?.method === method ? value : null;
}

export interface PositionReportAudit {
  violations: string[];
  inputBindingPassed: boolean;
  mode: "shares" | "budget" | null;
}

/** Recompute the curated position-sizer's preserved inputs. No value is returned to the command layer. */
export function auditPositionReport(raw: unknown): PositionReportAudit {
  const report = object(raw), violations: string[] = [];
  if (!report || report.schema_version !== "1.0" || !["shares", "budget"].includes(String(report.mode))) {
    return { violations: ["incomplete-report"], inputBindingPassed: false, mode: null };
  }
  const mode = report.mode as "shares" | "budget", parameters = object(report.parameters), calculations = object(report.calculations);
  if (!parameters || !calculations) return { violations: ["incomplete-report"], inputBindingPassed: false, mode };
  const account = number(parameters.account_size);
  if (account === null || account <= 0) violations.push("invalid-account-input");

  if (mode === "budget") {
    const winRate = number(parameters.win_rate), averageWin = number(parameters.avg_win), averageLoss = number(parameters.avg_loss);
    const kelly = calculation(calculations.kelly, "kelly");
    if (account === null || winRate === null || winRate <= 0 || winRate > 1 || averageWin === null || averageWin <= 0
      || averageLoss === null || averageLoss <= 0 || !kelly) violations.push("invalid-kelly-input-or-calculation");
    else {
      const expectedKelly = round2(Math.max(0, winRate - (1 - winRate) / (averageWin / averageLoss)) * 100);
      const expectedHalf = round2(expectedKelly / 2);
      if (!close(kelly.kelly_pct, expectedKelly) || !close(kelly.half_kelly_pct, expectedHalf)
        || !close(report.recommended_risk_budget_pct, expectedHalf)
        || !close(report.recommended_risk_budget, round2(account * expectedHalf / 100))) violations.push("wrong-kelly-budget-arithmetic");
    }
    if (calculations.fixed_fractional !== null || calculations.atr_based !== null) violations.push("unexpected-budget-calculation");
    return { violations: [...new Set(violations)], inputBindingPassed: !violations.length, mode };
  }

  const entry = number(parameters.entry_price), stop = number(parameters.stop_price), riskPct = number(parameters.risk_pct);
  const fractional = parameters.fractional_shares === true;
  const precision = parameters.share_precision === undefined ? 4 : number(parameters.share_precision);
  if (entry === null || entry <= 0 || precision === null || !Number.isInteger(precision) || precision < 0 || precision > 8) {
    violations.push("invalid-share-input");
  }
  const fixed = calculation(calculations.fixed_fractional, "fixed_fractional");
  const atr = calculation(calculations.atr_based, "atr_based");
  const kelly = calculation(calculations.kelly, "kelly");
  if ([fixed, atr, kelly].filter(Boolean).length !== 1) violations.push("invalid-active-calculation");
  let baseShares: number | null = null, riskPerShare: number | null = null;
  let inputBindingPassed = true;
  if (account !== null && entry !== null && precision !== null && Number.isInteger(precision)) {
    if (fixed) {
      if (stop === null || stop >= entry || riskPct === null || riskPct <= 0) violations.push("invalid-fixed-input");
      else {
        riskPerShare = entry - stop;
        const dollars = account * riskPct / 100;
        baseShares = floorShares(dollars / riskPerShare, fractional, precision);
        if (!close(fixed.risk_per_share, round2(riskPerShare)) || !close(fixed.dollar_risk, round2(dollars))
          || !close(fixed.stop_price, stop) || !close(fixed.shares, baseShares)) violations.push("wrong-fixed-fractional-arithmetic");
      }
    } else if (atr) {
      const atrValue = number(atr.atr), multiplier = number(atr.atr_multiplier);
      if (riskPct === null || riskPct <= 0 || atrValue === null || atrValue <= 0 || multiplier === null || multiplier <= 0) violations.push("invalid-atr-input");
      else {
        riskPerShare = atrValue * multiplier;
        const dollars = account * riskPct / 100, expectedStop = round2(entry - riskPerShare);
        baseShares = floorShares(dollars / riskPerShare, fractional, precision);
        if (!close(atr.risk_per_share, round2(riskPerShare)) || !close(atr.dollar_risk, round2(dollars))
          || !close(atr.stop_price, expectedStop) || !close(atr.shares, baseShares) || stop === null || !close(stop, expectedStop))
          violations.push("wrong-atr-arithmetic");
      }
    } else if (kelly) {
      const full = number(kelly.kelly_pct), half = number(kelly.half_kelly_pct);
      inputBindingPassed = false;
      if (full === null || half === null || full < 0 || full > 100 || !close(half, round2(full / 2))) violations.push("invalid-kelly-share-calculation");
      else {
        const budget = account * half / 100;
        riskPerShare = stop === null ? null : entry - stop;
        if (riskPerShare !== null && riskPerShare <= 0) violations.push("invalid-kelly-share-stop");
        else baseShares = floorShares(budget / (riskPerShare ?? entry), fractional, precision);
      }
    }
  }

  const constraints = Array.isArray(report.constraints_applied) ? report.constraints_applied.map(object) : null;
  if (!constraints || constraints.some(item => !item)) violations.push("invalid-constraints");
  const candidates = baseShares === null ? [] : [baseShares];
  const expectedConstraints: Array<{ row: JsonRecord; shares: number }> = [];
  if (constraints && account !== null && entry !== null && precision !== null && Number.isInteger(precision)) {
    const seen = new Set<string>();
    for (const row of constraints) {
      if (!row || !["max_position_pct", "max_sector_pct"].includes(String(row.type)) || seen.has(String(row.type))) {
        violations.push("invalid-constraints"); continue;
      }
      seen.add(String(row.type));
      const limit = number(row.limit), current = row.type === "max_sector_pct" ? number(row.current) : 0;
      if (limit === null || current === null) { violations.push("invalid-constraints"); continue; }
      const available = row.type === "max_sector_pct" ? Math.max(0, limit - current) : limit;
      const shares = floorShares(account * available / 100 / entry, fractional, precision);
      if (!close(row.max_shares, shares)) violations.push("wrong-constraint-arithmetic");
      candidates.push(shares); expectedConstraints.push({ row, shares });
    }
  }
  if (baseShares !== null && candidates.length) {
    const expectedFinal = Math.max(0, Math.min(...candidates));
    let expectedBinding: string | null = null;
    for (const item of expectedConstraints) {
      const binding = close(item.shares, expectedFinal) && expectedFinal < baseShares;
      if (item.row.binding !== binding) violations.push("wrong-binding-constraint");
      if (binding) expectedBinding = String(item.row.type);
    }
    if (!close(report.final_recommended_shares, expectedFinal) || report.binding_constraint !== expectedBinding
      || !close(report.final_position_value, round2(expectedFinal * (entry ?? 0)))) violations.push("wrong-final-position");
    if (riskPerShare === null) {
      if (report.final_risk_dollars !== null || report.final_risk_pct !== null || typeof report.risk_note !== "string") violations.push("wrong-final-risk");
    } else if (account !== null) {
      if (!close(report.final_risk_dollars, round2(expectedFinal * riskPerShare))
        || !close(report.final_risk_pct, round2(expectedFinal * riskPerShare / account * 100))) violations.push("wrong-final-risk");
    }
  }
  return { violations: [...new Set(violations)], inputBindingPassed: inputBindingPassed && !violations.length, mode };
}

function section(markdown: string, title: string): string {
  const start = markdown.indexOf(title);
  if (start < 0) return "";
  const tail = markdown.slice(start + title.length), end = tail.search(/\n## /);
  return end < 0 ? tail : tail.slice(0, end);
}

function visibleNumber(text: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`(?:\\*\\*)?${escaped}(?::\\*\\*|\\*\\*:|:)\\s*\\$?([+-]?[0-9][0-9,.]*)`, "i"));
  return match ? Number(match[1]!.replace(/,/g, "")) : null;
}

function visibleRiskPercent(text: string): number | null {
  const match = text.match(/\*\*Risk:\*\*\s*\$?[+-]?[0-9][0-9,.]*\s*\(([+-]?[0-9][0-9,.]*)%\)/i);
  return match ? Number(match[1]!.replace(/,/g, "")) : null;
}

function visibleBudgetPercent(text: string): number | null {
  const match = text.match(/\(([+-]?[0-9][0-9,.]*)% of account\)/i);
  return match ? Number(match[1]!.replace(/,/g, "")) : null;
}

function methodTitle(method: unknown): string {
  return typeof method === "string" ? method.split("_").map(part => part ? part[0]!.toUpperCase() + part.slice(1) : "").join(" ") : "";
}

/** Check the human-readable claims without copying the selected report or its values. */
export function auditPositionPresentation(raw: unknown, markdown: string): string[] {
  const report = object(raw), issues: string[] = [];
  if (!report || typeof report.mode !== "string" || !markdown.includes("# Position Sizing Report")) return ["incomplete-markdown"];
  const parameters = object(report.parameters), parameterText = section(markdown, "## Parameters");
  if (!parameters || !parameterText || !markdown.includes(`**Mode:** ${report.mode}`)) issues.push("markdown-parameter-mismatch");
  else {
    if ((parameterText.match(/^- /gm)?.length ?? 0) !== Object.keys(parameters).length) issues.push("markdown-parameter-mismatch");
    for (const [key, value] of Object.entries(parameters)) {
      if (typeof value === "number" && (!close(visibleNumber(parameterText, key), value))) issues.push("markdown-parameter-mismatch");
      if (typeof value === "boolean" && !parameterText.includes(`- **${key}:** ${value ? "True" : "False"}`)) issues.push("markdown-parameter-mismatch");
    }
  }
  if (report.mode === "budget") {
    const text = section(markdown, "## Kelly Criterion");
    if (!close(visibleNumber(text, "Recommended Risk Budget"), number(report.recommended_risk_budget) ?? NaN)
      || !close(visibleNumber(text, "Full Kelly"), number(object(object(report.calculations)?.kelly)?.kelly_pct) ?? NaN)
      || !close(visibleNumber(text, "Half Kelly (recommended)"), number(object(object(report.calculations)?.kelly)?.half_kelly_pct) ?? NaN)
      || !close(visibleBudgetPercent(text), number(report.recommended_risk_budget_pct) ?? NaN)
      || typeof report.note !== "string" || !text.includes(`*${report.note}*`) || markdown.includes("## Final Recommendation"))
      issues.push("markdown-budget-mismatch");
  } else {
    const calculations = object(report.calculations), calculationText = section(markdown, "## Calculations");
    const active = calculations ? Object.values(calculations).map(object).find(Boolean) : null;
    if (!active || !calculationText || (calculationText.match(/^### /gm)?.length ?? 0) !== 1
      || !calculationText.includes(`### ${methodTitle(active.method)}`)
      || (calculationText.match(/^- /gm)?.length ?? 0) !== Object.keys(active).filter(key => key !== "method").length)
      issues.push("markdown-calculation-mismatch");
    else for (const [key, value] of Object.entries(active)) {
      if (key !== "method" && typeof value === "number" && !close(visibleNumber(calculationText, key), value)) issues.push("markdown-calculation-mismatch");
    }
    const text = section(markdown, "## Final Recommendation");
    const expectedFinalLines = 2 + (number(report.final_risk_dollars) === null ? 0 : 1)
      + (typeof report.risk_note === "string" ? 1 : 0) + (typeof report.binding_constraint === "string" ? 1 : 0);
    if (!close(visibleNumber(text, "Shares"), number(report.final_recommended_shares) ?? NaN)
      || !close(visibleNumber(text, "Position Value"), number(report.final_position_value) ?? NaN)
      || (text.match(/^- /gm)?.length ?? 0) !== expectedFinalLines) issues.push("markdown-final-position-mismatch");
    if (number(report.final_risk_dollars) !== null && (!close(visibleNumber(text, "Risk"), number(report.final_risk_dollars)!)
      || !close(visibleRiskPercent(text), number(report.final_risk_pct) ?? NaN))) issues.push("markdown-final-risk-mismatch");
    if (number(report.final_risk_dollars) === null && text.includes("**Risk:**")) issues.push("markdown-final-risk-mismatch");
    if (typeof report.risk_note === "string" ? !text.includes(`**Note:** ${report.risk_note}`) : text.includes("**Note:**"))
      issues.push("markdown-final-risk-mismatch");
    if (typeof report.binding_constraint === "string"
      ? !text.includes(`**Binding Constraint:** ${report.binding_constraint}`) : text.includes("**Binding Constraint:**"))
      issues.push("markdown-binding-mismatch");
    const constraints = Array.isArray(report.constraints_applied) ? report.constraints_applied.map(object) : [];
    const constraintText = section(markdown, "## Constraints");
    if (constraints.length === 0 ? markdown.includes("## Constraints") : (constraintText.match(/^- /gm)?.length ?? 0) !== constraints.length)
      issues.push("markdown-constraint-mismatch");
    for (const row of constraints) {
      if (!row || typeof row.type !== "string") { issues.push("markdown-constraint-mismatch"); continue; }
      const escaped = row.type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = constraintText.match(new RegExp(`${escaped}:\\s*limit=([+-]?[0-9][0-9,.]*)%,\\s*max_shares=([+-]?[0-9][0-9,.]*)(.*)$`, "mi"));
      if (!match || !close(Number(match[1]!.replace(/,/g, "")), number(row.limit) ?? NaN)
        || !close(Number(match[2]!.replace(/,/g, "")), number(row.max_shares) ?? NaN)
        || match[3]!.includes("[BINDING]") !== (row.binding === true)) issues.push("markdown-constraint-mismatch");
    }
  }
  return [...new Set(issues)];
}
