import { isDeepStrictEqual } from "node:util";
import { normalizeSymbol } from "../market/symbols.ts";
import { isObservationTime } from "../market/fund-nav.ts";
import {
  comparePortfolios, comparisonMethodNotes,
} from "../quant/index.ts";
import { priceAdjustmentNote } from "../market/price-adjustment.ts";
import { loadPortfolioComparison } from "../storage/index.ts";
import type { PortfolioComparisonArtifact } from "../types/portfolio-comparison.ts";
import type { ResearchAnalysis, ResearchComparison, ResearchDataset } from "./types.ts";
import { matches } from "./match.ts";
import { COMPARISON_COMMON_METRIC, COMPARISON_SERIES_METRICS as labels, comparisonSeriesLabels } from "./comparison-metrics.ts";

export class UnboundComparisonResult extends Error {}

/** Bind the call, immutable comparison (including FX), public price revisions and recomputed result. */
export function verifyResearchComparison(name: string, args: Record<string, unknown>, saved: Record<string, unknown>,
  roles: Record<string, number>, datasets: ResearchDataset[], resolve: (id: string) => PortfolioComparisonArtifact = loadPortfolioComparison): ResearchAnalysis {
  if (typeof saved.id !== "string") throw new Error("Missing comparison ID.");
  const artifact = resolve(saved.id), { input } = artifact.result;
  if (artifact.id !== saved.id || artifact.version !== 1 || artifact.kind !== "portfolio-comparison" || ![1, 2].includes(artifact.result.methodVersion)
    || !matches(saved, artifact)) throw new Error("Comparison archive mismatch.");
  const request = input.request;
  if (!request) throw new UnboundComparisonResult("Comparison has no original request binding.");
  if (name === "compare_portfolios") {
    const expected = { groups: [args.group_a, args.group_b], start: args.start, end: args.end, benchmark: args.benchmark,
      baseCurrency: args.base_currency, currencies: args.currencies, weighting: args.weighting,
      missingMembers: args.missing_members ?? "fail", weights: [args.weights_a ?? null, args.weights_b ?? null] };
    if (!isDeepStrictEqual(request, expected)) throw new Error("Comparison call mismatch.");
  } else if (name !== "portfolio_comparisons" || args.id !== artifact.id) throw new Error("Comparison history selection mismatch.");

  // Bare fund aliases were resolved with the captured observation-group metadata, not today's groups.
  const canonical = (code: string) => normalizeSymbol(/^\d{6}$/.test(code) && input.prices.some(price => price.symbol === `${code}.OF`) ? `${code}.OF` : code);
  if (request.start !== input.start || request.end !== input.end || canonical(request.benchmark) !== input.benchmark
    || request.baseCurrency !== input.baseCurrency || request.weighting !== input.weighting || request.missingMembers !== input.missingMembers
    || request.groups.length !== 2) throw new Error("Recorded comparison assumptions mismatch.");
  input.groups.forEach((group, index) => {
    if (request.groups[index] !== group.id && request.groups[index] !== group.name) throw new Error("Recorded group selection mismatch.");
    const weights = request.weights?.[index];
    const entries = weights ? Object.entries(weights).map(([symbol, value]) => [canonical(symbol), value] as const) : undefined;
    if (entries && new Set(entries.map(([symbol]) => symbol)).size !== entries.length
      || !isDeepStrictEqual(group.weights, entries ? Object.fromEntries(entries) : undefined)) throw new Error("Recorded weights mismatch.");
  });
  const currencies = Object.entries(request.currencies).map(([code, currency]) => [canonical(code), currency] as const);
  const symbols = new Set([...input.groups.flatMap(group => group.members), input.benchmark]);
  if (currencies.length !== symbols.size || input.prices.length !== symbols.size || new Set(currencies.map(([code]) => code)).size !== symbols.size
    || currencies.some(([code, currency]) => !symbols.has(code) || input.prices.find(price => price.symbol === code)?.currency !== currency)) throw new Error("Recorded quote currencies mismatch.");
  const indexes: number[] = [];
  input.prices.forEach((price, index) => {
    if (!/^[A-Z0-9^.\-]{1,24}$/.test(price.symbol) || normalizeSymbol(price.symbol) !== price.symbol) throw new Error("Invalid public comparison symbol.");
    // A genuinely empty member has no observation revision; its exclusion is recomputed below.
    if (!price.points.length && !price.dataset && input.missingMembers === "exclude") return;
    const datasetIndex = roles[`price-${index}`], dataset = datasetIndex === undefined ? undefined : datasets[datasetIndex];
    if (!dataset || !price.dataset || !matches(price.dataset, dataset.ref) || dataset.ref.symbol !== price.symbol
      || dataset.ref.source !== price.source || dataset.ref.snapshotAt !== price.observedAt) throw new Error("Missing matching archived comparison price.");
    const points = ("bars" in dataset ? dataset.bars.map(bar => ({ date: bar.date, price: bar.close }))
      : dataset.nav.map(row => ({ date: row.navDate, price: row.unitNav }))).filter(point => point.date >= input.start && point.date <= input.end);
    if (!isDeepStrictEqual(price.points, points)) throw new Error("Comparison prices differ from archived observations.");
    indexes.push(datasetIndex!);
  });
  const foreign = new Set(input.prices.filter(price => price.currency !== input.baseCurrency
    && price.points.filter(point => point.date >= input.start && point.date <= input.end).length >= 2).map(price => price.currency));
  const { fx } = input;
  if (fx.source !== (foreign.size ? "frankfurter-v2/ecb" : "identity")
    || !isObservationTime(fx.observedAt)
    || fx.points.some(point => !foreign.has(point.currency) || point.date < input.start || point.date > input.end)) throw new Error("Invalid archived FX provenance.");
  const result = comparePortfolios(input, artifact.result.methodVersion);
  if (!matches(artifact.result, result)) throw new Error("Comparison arithmetic mismatch.");
  const series: ResearchComparison["series"] = [...result.groups, result.benchmark].map((curve, index) => ({
    label: comparisonSeriesLabels(input.benchmark)[index]!,
    values: curve.nav.map(point => point.value),
    members: curve.members.map(member => ({ symbol: member.symbol, currency: member.currency, initialWeight: member.initialWeight, localReturn: member.localReturn, baseReturn: member.baseReturn })),
    metrics: [
      { label: labels.totalReturn, value: curve.totalReturn, unit: "percent" }, { label: labels.cagr, value: curve.cagr, unit: "percent" },
      { label: labels.sharpe, value: curve.sharpe, unit: "number" }, { label: labels.maxDrawdown, value: curve.maxDrawdown, unit: "percent" },
      { label: labels.excessReturn, value: curve.excessReturn, unit: "percent" }, { label: labels.annualVol, value: curve.risk?.annualVol ?? null, unit: "percent" },
      { label: labels.downsideVol, value: curve.risk?.downsideVol ?? null, unit: "percent" },
      { label: labels.var95, value: curve.risk?.var95 ?? null, unit: "percent" }, { label: labels.cvar95, value: curve.risk?.cvar95 ?? null, unit: "percent" },
    ],
  }));
  return { kind: "portfolio-comparison", title: `Portfolio comparison · ${input.baseCurrency} · ${input.weighting}`,
    datasetIndexes: [...new Set(indexes)], metrics: [{ label: COMPARISON_COMMON_METRIC, value: result.dates.length, unit: "periods" }],
    assumptions: [`Requested: ${input.start} — ${input.end}. Common: ${result.dates[0]} — ${result.dates.at(-1)}.`,
      `Quote currencies are explicit research assumptions. Missing members: ${input.missingMembers}; excluded weights are renormalized.`,
      "Price/NAV revisions and FX observations are frozen. Archive hashes detect inconsistency, not provider authenticity or historical availability.",
      ...[...new Set(indexes)].map(index => datasets[index]!).filter(dataset => "bars" in dataset)
        .map(dataset => `${dataset.ref.symbol}: ${priceAdjustmentNote(dataset.ref.adjustment)}`),
      ...comparisonMethodNotes(result)],
    comparison: { dates: [...result.dates], series,
      excluded: result.excludedMembers.map(item => ({ portfolio: item.groupId === input.groups[0].id ? "Portfolio A" : "Portfolio B", symbol: item.symbol })),
      droppedDates: result.droppedDates.map(item => ({ date: item.date, missing: [...item.missing] })),
      fx: { source: fx.source as ResearchComparison["fx"]["source"], observedAt: fx.observedAt, baseCurrency: input.baseCurrency,
        points: fx.points.map(point => ({ currency: point.currency, date: point.date, rate: point.rate })) } },
  };
}
