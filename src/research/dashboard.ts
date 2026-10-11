import { createHash } from "node:crypto";
import { collectResults, dashboardSummary, rankResults } from "../quant/dashboard.ts";
import type { ResultRow } from "../quant/dashboard.ts";
import { isDailyDate } from "../market/bars.ts";
import type { ResearchAnalysis, ResearchDataset } from "./types.ts";
import { record } from "./references.ts";
import { verifyResearchAnalysis } from "./analysis.ts";
import { matches } from "./match.ts";
import { BENCHMARK_PRICE_BASIS } from "../quant/benchmark.ts";
import { priceAdjustmentNote } from "../market/price-adjustment.ts";

export class UnboundDashboardResult extends Error {}

/** Verify the entire captured cohort before describing its summary or top ten as matched. */
export function verifyResearchDashboard(args: Record<string, unknown>, saved: Record<string, unknown>, roles: Record<string, number>, datasets: ResearchDataset[]): ResearchAnalysis {
  const sortBy = args.sort_by ?? "score";
  if (!["score", "cagr", "sharpe"].includes(String(sortBy)) || saved.sortBy !== sortBy || saved.methodVersion !== 1 || !Array.isArray(saved.snapshots)) throw new Error("Invalid dashboard capture");
  if (!Number.isInteger(saved.unavailableFiles) || (saved.unavailableFiles as number) < 0) throw new Error("Invalid dashboard coverage");
  const rows: ResultRow[] = [], analyses = new Map<ResultRow, ResearchAnalysis>(), benchmarkSymbols = new Set<string>();
  let invalid = 0, previousFilename: string | undefined;
  for (let index = 0; index < saved.snapshots.length; index++) {
    const snapshot = record(saved.snapshots[index]), result = record(snapshot?.result);
    if (!snapshot || !result || typeof snapshot.filename !== "string" || !snapshot.filename
      || (previousFilename !== undefined && previousFilename >= snapshot.filename)
      || snapshot.revision !== createHash("sha256").update(JSON.stringify(result)).digest("hex")) throw new Error("Dashboard snapshot mismatch");
    previousFilename = snapshot.filename;
    const row = collectResults([result])[0];
    if (!row) { invalid++; continue; }
    if (result.methodVersion !== 3) throw new UnboundDashboardResult("Saved evaluation lacks full replay parameters");
    const parameters = record(result.parameters);
    if (!parameters || ["fast", "slow", "cash", "commission", "stampDuty"].some(key => typeof parameters[key] !== "number" || !Number.isFinite(parameters[key]))
      || !isDailyDate(String(result.date))) throw new Error("Missing evaluation parameters");
    const evaluationRoles = { strategy: roles[`result-${index}-strategy`]!, benchmark: roles[`result-${index}-benchmark`]! };
    const strategy = datasets[evaluationRoles.strategy], benchmark = datasets[evaluationRoles.benchmark];
    if (!strategy || !benchmark || !matches(result, {
      window: { fast: parameters.fast, slow: parameters.slow },
      source: { strategy: { fetcher: strategy.ref.source, market: strategy.ref.market }, benchmark: { fetcher: benchmark.ref.source, market: benchmark.ref.market } },
      assumptions: { commission: parameters.commission, stampDuty: parameters.stampDuty, cagr: "calendar/365.25", periodsPerYear: 252, execution: "next-close", benchmark: "gross-buy-and-hold", split: "independent-restart", monthScore: "observed-calendar-months-including-partials" },
    })) throw new Error("Saved evaluation assumptions or sources mismatch");
    const analysis = verifyResearchAnalysis("score_benchmark", {
      symbol: result.symbol, benchmark_symbol: result.benchmark_symbol,
      fast: parameters.fast, slow: parameters.slow, cash: parameters.cash, commission: parameters.commission, stamp_duty: parameters.stampDuty,
    }, result, evaluationRoles, datasets);
    benchmarkSymbols.add(benchmark.ref.symbol);
    rows.push(row); analyses.set(row, analysis);
  }
  const summary = dashboardSummary(rows), ranked = rankResults(rows, sortBy as "score" | "cagr" | "sharpe");
  if (!matches(saved, { invalidResults: invalid, rows: ranked, summary })) throw new Error("Dashboard ranking or summary mismatch");
  return { kind: "dashboard", title: `Saved benchmark dashboard · ${sortBy}`, datasetIndexes: [...new Set([...analyses.values()].flatMap(analysis => analysis.datasetIndexes))],
    benchmarkSymbols: [...benchmarkSymbols],
    assumptions: [
      `Captured cohort: ${rows.length} valid evaluations; ${invalid} invalid records and ${saved.unavailableFiles} unreadable files excluded at scan time.`,
      `Top ${ranked.length} by ${sortBy}, descending; unavailable metrics last; ties keep captured scan order.`,
      "Every included evaluation was recomputed from archived prices and saved SMA/cost parameters before checking this summary.",
      "Evaluation windows, instruments and sources may differ. This is a saved-run ranking, not a common-window portfolio comparison.",
      BENCHMARK_PRICE_BASIS,
      ...[...new Set([...analyses.values()].flatMap(analysis => analysis.datasetIndexes))]
        .map(index => datasets[index]!).filter(dataset => "bars" in dataset)
        .map(dataset => `${dataset.ref.symbol}: ${priceAdjustmentNote(dataset.ref.adjustment)}`),
      "Calendar/365.25 CAGR; 252-period ratios; next-close trades; fractional shares; no slippage; gross buy-and-hold benchmark; independent 70/30 train/test restart.",
    ],
    metrics: [{ label: "Evaluations", value: summary.totalEvals, unit: "periods" }, { label: "Average score / 100", value: summary.avgScore, unit: "number" },
      { label: "Median score / 100", value: summary.medianScore, unit: "number" }, { label: "Best score / 100", value: summary.bestScore, unit: "number" },
      { label: "Average Sharpe", value: summary.avgSharpe, unit: "number" }, { label: "Average max drawdown", value: summary.avgMaxDD, unit: "percent" }],
    ranking: ranked.map(row => {
      const analysis = analyses.get(row)!;
      return { title: analysis.title, basis: `${analysis.curve!.dates[0]} — ${analysis.curve!.dates.at(-1)}; ${analysis.assumptions.find(note => note.startsWith("SMA(")) ?? "Saved SMA parameters"}`, datasetIndexes: analysis.datasetIndexes,
        score: row.totalScore, cagr: row.cagr, sharpe: row.sharpe, maxDrawdown: row.maxDrawdown };
    }),
  };
}
