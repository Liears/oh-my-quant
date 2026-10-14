import { calculatePositionScenarios, type PositionScenarioInputs } from "../../quant/index.ts";
import { unquotedMethodProse } from "./performance-method-claims.ts";

function reportedNumber(cell: string): { value: number; decimals: number; rest: string } | null {
  const match = /^\s*([+\-−])?\s*(?:USD|\$|美元)?\s*([+\-−])?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/iu.exec(cell);
  if (!match) return null;
  const sign = match[1] ?? match[2], value = Number(match[3]!.replaceAll(",", ""));
  return { value: match[1] && match[2] ? NaN : (sign === "-" || sign === "−" ? -value : value),
    decimals: match[3]!.split(".")[1]?.length ?? 0, rest: cell.slice(match[0].length) };
}

function disagrees(reported: { value: number; decimals: number }, expected: number): boolean {
  return !Number.isFinite(reported.value) || Math.abs(reported.value - expected) > 0.5 * 10 ** -reported.decimals + 1e-8;
}

/** Labelled, unhedged scenario rows bound to explicit inputs; not a general prose or option-payoff judge. */
export function hedgeScenarioAnswerViolations(answer: string, position?: PositionScenarioInputs): string[] {
  if (!position) return [];
  const violations = new Set<string>();
  let columns: { scenario: number; price: number; value: number; pnl: number; percent: number; count: number } | null = null;
  for (const line of unquotedMethodProse(answer).split("\n")) {
    const row = (line.includes("|") ? line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|")
      : line.trim().split(/\s{2,}/u)).map(cell => cell.trim().replace(/^\*+|\*+$/gu, ""));
    const scenario = row.findIndex(cell => /^(?:场景|情景|Scenario)$/iu.test(cell));
    const price = row.findIndex(cell => /^(?:假设收盘价|假设价格|Price|(?:Hypothetical|Stock) (?:price|close))$/iu.test(cell));
    const value = row.findIndex(cell => /^(?:头寸价值|持仓市值|Position value)$/iu.test(cell));
    const pnl = row.findIndex(cell => /^(?:盈亏|P\/L|PnL|Profit(?:\/loss)?)[^\n]{0,40}(?:成本|cost)/iu.test(cell) && !/[%％]/u.test(cell));
    const percent = row.findIndex(cell => /成本|cost/iu.test(cell) && /[%％]|收益率|return/iu.test(cell));
    if ([scenario, price, value, pnl].every(index => index >= 0)) columns = { scenario, price, value, pnl, percent, count: row.length };
    else if (!line.trim()) columns = null;
    else if (columns && row.length === columns.count) {
      const label = row[columns.scenario]!, changeMatch = /^([+\-−]?\d+(?:\.\d+)?)\s*[%％]$/u.exec(label);
      const change = changeMatch ? Number(changeMatch[1]!.replace("−", "-")) / 100
        : /^(?:flat|不变|持平)$/iu.test(label) ? 0
          : /^(?:Back to cost|回本)$/iu.test(label) ? position.costPerShare / position.observedClose - 1 : null;
      if (change === null) continue;
      if (change < -1) { violations.add("invalid-hedge-scenario-change"); continue; }
      const expected = calculatePositionScenarios(position, [change])[0]!;
      for (const [column, target, code] of [[columns.price, expected.price, "price"], [columns.value, expected.value, "value"],
        [columns.pnl, expected.profitLoss, "pnl"]] as const) {
        const reported = reportedNumber(row[column]!);
        if (reported && disagrees(reported, target)) violations.add(`wrong-hedge-scenario-${code}`);
      }
      const percentageCell = columns.percent >= 0 ? row[columns.percent]! : reportedNumber(row[columns.pnl]!)?.rest ?? "";
      const percentage = /([+\-−]?\d+(?:\.\d+)?)\s*[%％]/u.exec(percentageCell);
      const reported = percentage ? { value: Number(percentage[1]!.replace("−", "-")), decimals: percentage[1]!.split(".")[1]?.length ?? 0 }
        : columns.percent >= 0 ? reportedNumber(percentageCell) : null;
      if (reported) {
        if (disagrees(reported, expected.returnOnCost * 100)) violations.add("wrong-hedge-scenario-pnl-percent");
      }
    }
  }
  return [...violations];
}
