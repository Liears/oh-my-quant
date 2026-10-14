import type { DcaBacktestResult } from "./fund-dca.ts";

/** Derived explanation only: preserves the numerical result and contains no contribution amounts. */
export function fundDcaInterpretationNotes(result: DcaBacktestResult): string[] {
  const first = result.trades[0]!, last = result.trades.at(-1)!, end = result.accountCurve.at(-1)!.date;
  const firstDays = (Date.parse(end) - Date.parse(first.tradeDate)) / 86_400_000;
  const lastDays = (Date.parse(end) - Date.parse(last.tradeDate)) / 86_400_000;
  const terminalPurchases = result.trades.filter(trade => trade.tradeDate === end).length;
  const purchaseNavs = new Set(result.trades.map(trade => trade.nav));
  const navLabel = (value: number) => String(Number(value.toPrecision(12)));
  const principalValueRatio = navLabel(1 + result.summary.returnRate);
  return [
    `Observed holding window: ${first.tradeDate} — ${end}; ${result.accountCurve.length} NAV valuation dates, ${Math.max(0, result.accountCurve.length - 1)} adjacent NAV intervals. Purchases: ${result.trades.length} on ${new Set(result.trades.map(trade => trade.tradeDate)).size} distinct dates; these are not holding periods.`,
    `First contribution: ${firstDays} calendar days to final valuation; last contribution: ${lastDays} days. ${firstDays === lastDays ? "All purchases share the same observed NAV date and holding duration." : "Contributions have different holding durations, not all capital invested at the start."}`,
    `First purchase NAV: ${navLabel(first.nav)} on ${first.tradeDate}; last purchase NAV: ${navLabel(last.nav)} on ${last.tradeDate}. Blended average unit cost: ${navLabel(result.summary.averageCost)} from net purchases / total units; ${purchaseNavs.size > 1 ? "purchase NAVs differ, so blended cost is not the NAV of every trade." : "all observed purchases use the same NAV."}`,
    `Purchases on final valuation date: ${terminalPurchases}; those new units have no subsequent NAV interval in this simulation, though purchase fees still apply.`,
    "Principal return = (final simulated value - cumulative gross contributions) / cumulative gross contributions; cumulative profit ratio, not annualized or a dated money-weighted rate.",
    `Verified principal identity: final simulated value / cumulative gross contributions = ${principalValueRatio}. Reconcile any printed final value and gross contributions with the verified Principal return before explaining them.`,
    `Principal return also equals the gross-contribution-weighted average of each purchase-to-final-value gain. This fixed-amount DCA has equal gross contribution weights. ${firstDays === lastDays ? "Observed purchases share the same holding duration." : "Purchase holding durations differ."} Equal weights are not a general rule for unequal investments.`,
    "Principal return depends on the unit NAV path, acquired units, contribution dates and fees. It is not independent of fund performance, and different contribution schedules or windows change this plan-level ratio.",
    "TWR = final cash-flow-adjusted performance index - 1; removes external contributions and includes purchase fees. Reference 1 before first purchase. It is not the gain on all contributed capital and does not establish manager skill.",
    "A TWR comparison needs matching valuation periods, return type, currency and consistent fee/distribution treatment; this unit-NAV-only simulation is not directly comparable with an unaligned fund or benchmark. One observed NAV interval cannot establish manager skill.",
    result.summary.xirr === null
      ? "XIRR: N/A means no dated money-weighted rate was solved, not zero return."
      : `XIRR is the solved annualized money-weighted rate for dated negative gross purchases and positive final simulated value, using actual days / 365. The observed cash-flow span is ${firstDays} calendar days; the number is not the holding-period return or a forecast. For spans shorter than one year, annualization extrapolates hypothetically and may be extreme, but a high solved rate is not a calculation error.`,
    "Maximum drawdown uses the observed TWR index, not the growing contributed balance. Missing or between-observation losses are not measured; zero observed drawdown does not mean no risk. This is a NAV simulation, not verified account performance.",
    "The .OF symbol and A-market data route do not establish the fund's underlying asset class, mandate or A-share exposure; those require separate source evidence.",
  ];
}
