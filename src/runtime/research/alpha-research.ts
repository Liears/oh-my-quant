import { isDeepStrictEqual } from "node:util";
import { createAkquantEngine, checkAkquantEngine, alphaRequestFromResearch, normalizeAlphaResearchRequest,
  verifyAlphaResearchResult, AlphaEngineError, type AlphaBacktestEngine } from "../../alpha/index.ts";
import { fetchBars, type BarsFetchResult } from "../../source/index.ts";
import { inferMarket } from "../../market/symbols.ts";
import { readSettings, readWhyjEnvValue, loadCachedBars, saveBars, loadDataset, saveAlphaRun, loadAlphaRun } from "../../storage/index.ts";
import { createStorageSourceProviderOptions } from "../data/source-runtime.ts";
import type { AlphaEngineStatus, AlphaResearchRequest, AlphaRunArtifact } from "../../types/alpha.ts";

export interface AlphaResearchDeps {
  check: (signal?: AbortSignal) => Promise<AlphaEngineStatus>;
  engine: AlphaBacktestEngine;
  data: (request: AlphaResearchRequest, signal?: AbortSignal) => Promise<BarsFetchResult>;
  resolveDataset: typeof loadDataset;
  save: typeof saveAlphaRun;
}

/** Freeze interpreter, credentials and selected source together, before any asynchronous work. */
export function createAlphaResearchDeps(): AlphaResearchDeps {
  const settings = readSettings(), env = { ...process.env, ...settings.env };
  const command = readWhyjEnvValue(env, "akquantPython")?.trim();
  const options = { python: { command: command ?? "" } };
  const providers = createStorageSourceProviderOptions(settings);
  return { check: signal => command ? checkAkquantEngine(options, signal) : Promise.resolve({ status: signal?.aborted ? "cancelled" : "not-configured", requiredVersion: "0.3.58" }),
    engine: createAkquantEngine(options), resolveDataset: loadDataset, save: saveAlphaRun,
    data: (request, signal) => fetchBars(request.symbol, inferMarket(request.symbol), request.start, request.end, undefined,
      { providers: { ...providers, signal }, deps: { loadCache: loadCachedBars, saveBars, getPreferredSource: () => settings.preferences.source } }) };
}

export async function runAlphaResearch(input: AlphaResearchRequest, signal?: AbortSignal, dependencies?: AlphaResearchDeps): Promise<AlphaRunArtifact> {
  signal?.throwIfAborted();
  const request = normalizeAlphaResearchRequest(structuredClone(input)), deps = dependencies ?? createAlphaResearchDeps();
  const status = await deps.check(signal);
  signal?.throwIfAborted();
  if (status.status !== "ready") throw new AlphaEngineError(status.status === "not-configured" ? "unavailable" : status.status,
    `AKQuant ${status.status}. Configure WHYJ_QUANT_AKQUANT_PYTHON with the verified environment; run alpha_engine_status.`);
  const data = await deps.data(request, signal);
  signal?.throwIfAborted();
  if (data.origin === "unavailable" || !data.dataset || data.bars.length < request.slow)
    throw new AlphaEngineError("input", `Need ${request.slow}+ bars and a fixed DatasetRef; no alpha run saved.`);
  if (data.source !== data.dataset.source || !isDeepStrictEqual(deps.resolveDataset(data.dataset), data.bars))
    throw new AlphaEngineError("input", "Alpha data differs from its archived revision.");
  const prepared = alphaRequestFromResearch(request, data.bars, data.dataset);
  const result = await deps.engine.run(prepared, signal);
  signal?.throwIfAborted();
  verifyAlphaResearchResult(request, result);
  if (!isDeepStrictEqual(result.request, prepared)) throw new AlphaEngineError("output", "Alpha engine replaced the requested observations.");
  signal?.throwIfAborted();
  return deps.save(request, result, data.origin, signal);
}

export function restoreAlphaResearch(id: string, load: typeof loadAlphaRun = loadAlphaRun, resolve: typeof loadDataset = loadDataset): AlphaRunArtifact {
  const artifact = load(id);
  const result = verifyAlphaResearchResult(artifact.request, artifact.result);
  if (artifact.id !== id || !isDeepStrictEqual(resolve(result.request.dataset!), result.request.bars))
    throw new AlphaEngineError("output", "Alpha archive or original price revision is unavailable or inconsistent.");
  return artifact;
}

export function formatAlphaResearch(artifact: AlphaRunArtifact): string {
  const { result, request } = artifact, ref = result.request.dataset!;
  return [`Alpha backtest  ${request.symbol}  SMA(${request.fast},${request.slow})`,
    `Engine        AKQuant ${result.engine.version} · rules ${result.engine.ruleVersion}`,
    `Requested     ${request.start} → ${request.end}`,
    `Valuations    ${result.curve[0]!.date} → ${result.curve.at(-1)!.date} · ${result.curve.length} bars`,
    `Source        ${ref.source} · ${artifact.origin} at run time · observed ${ref.snapshotAt} · revision ${ref.revision}`,
    `Total return  ${(result.metrics.totalReturn * 100).toFixed(2)}%`, `CAGR          ${(result.metrics.cagr * 100).toFixed(2)}%`,
    `Sharpe        ${result.metrics.sharpe?.toFixed(2) ?? "N/A"} (RF 0)`, `Max DD        ${(result.metrics.maxDrawdown * 100).toFixed(2)}%`,
    `Orders        ${result.orders.length} · fills ${result.fills.length} · rejected ${result.orders.filter(order => order.status === "rejected").length}`,
    `Costs         commission ${request.commission} · slippage ${request.slippage}`,
    `Simulation    next open · integer shares · fixed quantity ${request.quantity} · initial cash ${request.cash}`,
    "Generic stock research only; T+0, no taxes/dividends/market calendar or trading restrictions; no live orders.",
    "Archived observations do not prove point-in-time availability or adjusted total returns.", `Saved run     ${artifact.id}`].join("\n");
}
