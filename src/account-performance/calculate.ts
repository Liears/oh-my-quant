import { maxDrawdown } from "../quant/performance.ts";
import type { AccountHistory, AccountPerformance } from "./types.ts";
import { validateAccountHistory } from "./validation.ts";

/** Each return ends before the next flow; denominators include the previous flow exactly once. */
export function calculateAccountPerformance(history: AccountHistory): AccountPerformance {
  validateAccountHistory(history);
  const flows = new Map<number, number>();
  for (const event of history.externalFlows) flows.set(event.at, (flows.get(event.at) ?? 0) + event.amount);
  const returns: number[] = [], points: AccountPerformance["points"] = [];
  let previousEquity = history.valuations[0]!.equityBeforeFlow, unitEquity = 1;
  for (const [index, point] of history.valuations.entries()) {
    const growth = index ? point.equityBeforeFlow / previousEquity : 1, periodReturn = index ? growth - 1 : null;
    if (periodReturn !== null) { returns.push(periodReturn); unitEquity *= growth; }
    previousEquity = point.equityBeforeFlow + (flows.get(point.at) ?? 0);
    if (!Number.isFinite(unitEquity) || unitEquity === 0 && point.equityBeforeFlow > 0 || !Number.isFinite(previousEquity) || Math.abs(previousEquity) > Number.MAX_SAFE_INTEGER
      || previousEquity < 0 || index < history.valuations.length - 1 && previousEquity === 0) throw new Error("Account capital is exhausted, negative or outside the supported numeric range; split a restarted account into separate studies.");
    points.push({ at: point.at, unitEquity, periodReturn });
  }
  const openingEquity = history.valuations[0]!.equityBeforeFlow, closingEquity = previousEquity;
  const netExternalFlow = history.externalFlows.reduce((sum, event) => sum + event.amount, 0);
  const feesAlreadyDeducted = history.fees.reduce((sum, event) => sum + event.amount, 0);
  const netProfit = closingEquity - openingEquity - netExternalFlow;
  if ([netExternalFlow, feesAlreadyDeducted, netProfit].some(value => !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) throw new Error("Account totals exceed the supported numeric range.");
  return { visibility: "private-live-only", method: "flow-valuations-twr-v1", verification: "input-consistency-only",
    request: structuredClone(history.request), source: structuredClone(history.source), openingEquity, closingEquity, netExternalFlow, netProfit,
    feesAlreadyDeducted, timeWeightedReturn: unitEquity - 1, observedMaxDrawdown: maxDrawdown(returns), points,
    limitations: [
      "External flows, reporting currency, fee inclusion and completeness are adapter statements, not independently authenticated financial facts.",
      "Return links valuations at every external flow; retained income and trades are internal. Fees already deducted from equity are disclosed without a second deduction.",
      "Drawdown covers supplied valuation instants only; no daily risk annualization, trading-calendar coverage or GIPS compliance is asserted.",
      "Account identity and all derived results remain private. No persistence, Agent context, automatic artifact or public-share output is provided by this module.",
    ] };
}
