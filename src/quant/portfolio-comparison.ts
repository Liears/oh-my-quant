import { isDailyDate, validateDateRange } from "../market/bars.ts";
import { calendarYears, maxDrawdown, sharpe } from "./performance.ts";
import { metrics } from "./risk.ts";
import { comparisonWarning } from "./portfolio-comparison-notes.ts";
import type { ComparisonCurve, ComparisonGroup, ComparisonPrice, PortfolioComparisonInput, PortfolioComparisonResult } from "../types/portfolio-comparison.ts";

/** Align valuations first. A return over a missing-day gap must cover the same dates for every member. */
export function comparePortfolios(input: PortfolioComparisonInput, methodVersion: PortfolioComparisonResult["methodVersion"] = 2): PortfolioComparisonResult {
  if (methodVersion !== 1 && methodVersion !== 2) throw new Error("Unsupported comparison method version.");
  validateDateRange(input.start, input.end);
  if (!input.start || !input.end || input.start === input.end) throw new Error("Choose a nonzero comparison date range.");
  if (input.groups.length !== 2 || input.groups[0].id === input.groups[1].id) throw new Error("Choose two different portfolios.");
  if (!/^[A-Z]{3}$/.test(input.baseCurrency) || input.fx.baseCurrency !== input.baseCurrency) throw new Error("FX base currency mismatch.");
  if (!["buy-and-hold", "rebalance"].includes(input.weighting) || !["fail", "exclude"].includes(input.missingMembers)) throw new Error("Invalid comparison method.");
  const prices = new Map<string, ComparisonPrice>();
  const values = new Map<string, Map<string, number>>();
  for (const price of input.prices) {
    if (prices.has(price.symbol)) throw new Error(`Duplicate price input: ${price.symbol}`);
    if (!/^[A-Z]{3}$/.test(price.currency)) throw new Error(`Specify quote currency for ${price.symbol}.`);
    const points = new Map<string, number>();
    for (const point of price.points) {
      if (!isDailyDate(point.date) || !Number.isFinite(point.price) || point.price <= 0 || points.has(point.date)) throw new Error(`Invalid or duplicate price: ${price.symbol}`);
      points.set(point.date, point.price);
    }
    prices.set(price.symbol, price);
    values.set(price.symbol, new Map([...points].filter(([date]) => date >= input.start && date <= input.end)));
  }
  const excludedMembers: PortfolioComparisonResult["excludedMembers"] = [];
  const groups = input.groups.map(group => {
    if (!group.members.length) throw new Error(`Portfolio ${group.name} is empty.`);
    if (new Set(group.members).size !== group.members.length) throw new Error(`Duplicate portfolio member: ${group.name}`);
    if (group.weights) {
      const entries = Object.entries(group.weights);
      if (entries.length !== group.members.length || entries.some(([symbol, weight]) => !group.members.includes(symbol) || !Number.isFinite(weight) || weight <= 0)
        || Math.abs(entries.reduce((sum, [, weight]) => sum + weight, 0) - 1) > 1e-9) throw new Error(`Weights for ${group.name} must cover every member and sum to 1.`);
    }
    const members = group.members.filter(symbol => {
      if ((values.get(symbol)?.size ?? 0) >= 2) return true;
      excludedMembers.push({ groupId: group.id, symbol, reason: prices.get(symbol)?.unavailableReason ?? "Fewer than two prices in the requested window" });
      return false;
    });
    if (!members.length || members.length !== group.members.length && input.missingMembers === "fail") throw new Error(`Insufficient member prices in ${group.name}: ${group.members.filter(symbol => !members.includes(symbol)).join(", ")}`);
    return { ...group, members };
  }) as [ComparisonGroup, ComparisonGroup];
  if ((values.get(input.benchmark)?.size ?? 0) < 2) throw new Error(`Benchmark ${input.benchmark} has insufficient prices.`);
  const required = [...new Set([...groups.flatMap(group => group.members), input.benchmark])];
  const fx = new Map<string, Map<string, number>>();
  for (const point of input.fx.points) {
    if (!isDailyDate(point.date) || !/^[A-Z]{3}$/.test(point.currency) || !Number.isFinite(point.rate) || point.rate <= 0) throw new Error("Invalid FX observation.");
    const dates = fx.get(point.currency) ?? new Map<string, number>();
    if (dates.has(point.date)) throw new Error("Duplicate FX observation.");
    dates.set(point.date, point.rate); fx.set(point.currency, dates);
  }
  for (const symbol of required) {
    const currency = prices.get(symbol)!.currency;
    if (currency !== input.baseCurrency && !fx.get(currency)?.size) throw new Error(`Missing ${currency}/${input.baseCurrency} FX rates; comparison was not calculated.`);
  }
  const candidates = [...new Set(required.flatMap(symbol => [...values.get(symbol)!.keys()]))].sort();
  const droppedDates: PortfolioComparisonResult["droppedDates"] = [];
  const dates = candidates.filter(date => {
    const missing = required.flatMap(symbol => {
      if (!values.get(symbol)!.has(date)) return [`price:${symbol}`];
      const currency = prices.get(symbol)!.currency;
      return currency !== input.baseCurrency && !fx.get(currency)?.has(date) ? [`fx:${currency}/${input.baseCurrency}`] : [];
    });
    if (missing.length) droppedDates.push({ date, missing: [...new Set(missing)] });
    return !missing.length;
  });
  if (dates.length < 2) throw new Error(`Need at least two common price/FX dates; found ${dates.length}.`);
  const elapsedYears = calendarYears(dates), periodsPerYear = (dates.length - 1) / elapsedYears;
  const basePrice = (symbol: string, date: string) => {
    const currency = prices.get(symbol)!.currency;
    const value = values.get(symbol)!.get(date)! * (currency === input.baseCurrency ? 1 : fx.get(currency)!.get(date)!);
    if (!Number.isFinite(value) || value <= 0) throw new Error("Converted price exceeds supported numeric range.");
    return value;
  };
  const makeCurve = (group: ComparisonGroup, weighting: PortfolioComparisonInput["weighting"]): ComparisonCurve => {
    const totalWeight = group.members.reduce((sum, symbol) => sum + (group.weights?.[symbol] ?? 1), 0);
    const members = group.members.map(symbol => ({ symbol, currency: prices.get(symbol)!.currency,
      initialWeight: (group.weights?.[symbol] ?? 1) / totalWeight,
      localReturn: values.get(symbol)!.get(dates.at(-1)!)! / values.get(symbol)!.get(dates[0]!)! - 1,
      baseReturn: basePrice(symbol, dates.at(-1)!) / basePrice(symbol, dates[0]!) - 1 }));
    let value = 1;
    const nav = dates.map((date, index) => {
      if (index) value = weighting === "buy-and-hold"
        ? members.reduce((sum, member) => sum + member.initialWeight * basePrice(member.symbol, date) / basePrice(member.symbol, dates[0]!), 0)
        : value * members.reduce((sum, member) => sum + member.initialWeight * basePrice(member.symbol, date) / basePrice(member.symbol, dates[index - 1]!), 0);
      if (!Number.isFinite(value) || value <= 0) throw new Error("Portfolio NAV exceeds supported numeric range.");
      return { date, value };
    });
    const returns = nav.slice(1).map((point, index) => point.value / nav[index]!.value - 1);
    if (returns.some(value => !Number.isFinite(value) || value <= -1)
      || members.some(member => !Number.isFinite(member.localReturn) || !Number.isFinite(member.baseReturn))) throw new Error("Return exceeds supported numeric range.");
    const annualized = Math.expm1(Math.log(value) / elapsedYears);
    const risk = returns.length >= 2 ? metrics(returns, periodsPerYear) : null;
    const ratio = sharpe(returns, 0, periodsPerYear);
    if (risk && Object.values(risk).some(value => !Number.isFinite(value)) || ratio !== null && !Number.isFinite(ratio)) throw new Error("Risk exceeds supported numeric range.");
    return { id: group.id, name: group.name, members, nav, totalReturn: value - 1,
      cagr: Number.isFinite(annualized) ? annualized : null, sharpe: ratio, maxDrawdown: maxDrawdown(returns), risk, excessReturn: 0 };
  };
  const benchmark = makeCurve({ id: input.benchmark, name: input.benchmark, members: [input.benchmark] }, "buy-and-hold");
  const curves = groups.map(group => { const curve = makeCurve(group, input.weighting); curve.excessReturn = curve.totalReturn - benchmark.totalReturn; return curve; }) as [ComparisonCurve, ComparisonCurve];
  return { methodVersion, input: structuredClone(input), dates, droppedDates, excludedMembers, groups: curves, benchmark,
    assumptions: { currencyBasis: "explicit-research-assumption", fxAlignment: "same-date-only", priceBasis: "provider-close-or-unit-nav",
      periodicity: "common-observation-intervals", periodsPerYear, elapsedYears, costs: 0, fractionalShares: true,
      warning: methodVersion === 1 ? "Hypothetical allocations, not account holdings. No fees, taxes, dividends or corporate-action repair. Rebalance at common valuation dates only. Annualized risk approximates irregular observation intervals; VaR is per interval, not necessarily one trading day. Daily closes across markets are not simultaneous; FX is a reference rate, not an execution quote." : comparisonWarning(input.weighting) } };
}
