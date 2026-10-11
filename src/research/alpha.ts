import { isDeepStrictEqual } from "node:util";
import { normalizeAlphaResearchRequest, verifyAlphaResearchResult } from "../alpha/index.ts";
import { loadAlphaRun } from "../storage/index.ts";
import { priceAdjustmentNote } from "../market/price-adjustment.ts";
import type { AlphaRunArtifact } from "../types/alpha.ts";
import type { ResearchAnalysis, ResearchDataset } from "./types.ts";

/** Recheck archived receipts and ledger without starting Python or replacing observations. */
export function verifyResearchAlpha(name: string, args: Record<string, unknown>, saved: Record<string, unknown>,
  roles: Record<string, number>, datasets: ResearchDataset[], resolve: (id: string) => AlphaRunArtifact = loadAlphaRun): ResearchAnalysis {
  if (typeof saved.id !== "string") throw new Error("Missing alpha archive ID.");
  const artifact = resolve(saved.id);
  if (!isDeepStrictEqual(artifact, saved) || artifact.kind !== "alpha-backtest") throw new Error("Alpha archive mismatch.");
  if (name === "alpha_backtest" ? !isDeepStrictEqual(normalizeAlphaResearchRequest(args), artifact.request)
    : args.id !== artifact.id || Object.keys(args).some(key => key !== "id")) throw new Error("Alpha request mismatch.");
  const result = verifyAlphaResearchResult(artifact.request, artifact.result);
  const index = roles.input, dataset = index === undefined ? undefined : datasets[index];
  if (!dataset || !("bars" in dataset) || !isDeepStrictEqual(dataset.ref, result.request.dataset)
    || !isDeepStrictEqual(dataset.bars, result.request.bars)) throw new Error("Missing matching alpha observations.");
  const { request } = artifact, metrics = result.metrics;
  return { kind: "alpha-backtest", title: `${dataset.ref.symbol} · AKQuant SMA(${request.fast},${request.slow})`, datasetIndexes: [index!],
    metrics: [
      { label: "Total return", value: metrics.totalReturn, unit: "percent" },
      { label: "CAGR", value: metrics.cagr, unit: "percent" },
      { label: "Sharpe", value: metrics.sharpe, unit: "number" },
      { label: "Annual volatility", value: metrics.annualVol, unit: "percent" },
      { label: "Maximum drawdown", value: metrics.maxDrawdown, unit: "percent" },
    ],
    assumptions: [
      `AKQuant ${result.engine.version}; rules ${result.engine.ruleVersion}; archived receipts and ledger verified; matching engine not rerun.`,
      `Commission ${request.commission}; slippage ${request.slippage}; calendar/365.25 CAGR; ${request.periods_per_year}-period annualization; risk-free rate 0.`,
      "Hypothetical fixed integer shares; next open; T+0; no taxes, dividends, exchange calendar or trading restrictions; no forced final liquidation.",
      priceAdjustmentNote(dataset.ref.adjustment),
      "Observations recorded at fetch time, not proof of point-in-time availability. Normalized initial value 1.",
    ],
    curve: { dates: result.curve.map(point => point.date), values: result.curve.map(point => point.equity / result.request.initialCash) },
  };
}
