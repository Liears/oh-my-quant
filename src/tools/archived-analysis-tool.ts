import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { validateObservationCutoff } from "../market/observation-cutoff.ts";
import { validateDateRange } from "../market/bars.ts";
import { normalizeSymbol } from "../market/symbols.ts";
import { createArchiveAnalysisBarsLoader, MissingArchiveAnalysisData } from "../runtime/data/archive-analysis-data.ts";
import { createPriceAnalysisTools } from "./quant-tools.ts";
import { err } from "./shared/results.ts";

const Common = {
  symbol: Type.String({ description: "Exact A, US, or HK market symbol" }),
  market: Type.Union([Type.Literal("A"), Type.Literal("US"), Type.Literal("HK")]),
  start: Type.String({ description: "Inclusive first price date YYYY-MM-DD; warmup stays inside this window" }),
  end: Type.String({ description: "Inclusive last price date YYYY-MM-DD" }),
  observed_before: Type.String({ description: "Exact UTC application observation cutoff YYYY-MM-DDTHH:mm:ss.sssZ" }),
  source: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("akshare"), Type.Literal("tushare"),
    Type.Literal("llmquant-data"), Type.Literal("financial-datasets")])),
};

const ArchivedAnalysis = Type.Object({ ...Common,
  analysis: Type.Union([Type.Literal("factor"), Type.Literal("backtest"), Type.Literal("risk")]),
  factor: Type.Optional(Type.Union([Type.Literal("momentum"), Type.Literal("reversal"), Type.Literal("volatility"),
    Type.Literal("volume_ratio"), Type.Literal("rsi"), Type.Literal("sma_deviation")],
    { description: "Required when analysis=factor" })),
  period: Type.Optional(Type.Integer({ default: 20, minimum: 1 })),
  fast: Type.Optional(Type.Integer({ default: 20, minimum: 1 })), slow: Type.Optional(Type.Integer({ default: 60, minimum: 2 })),
  cash: Type.Optional(Type.Number({ default: 100_000, exclusiveMinimum: 0 })),
  commission: Type.Optional(Type.Number({ default: 0.0003, minimum: 0, exclusiveMaximum: 1 })),
  stamp_duty: Type.Optional(Type.Number({ default: 0, minimum: 0, exclusiveMaximum: 1 })),
});

type ArchivedAnalysisArgs = Static<typeof ArchivedAnalysis>;

export const analyzeArchivedBarsTool: AgentTool<typeof ArchivedAnalysis> = {
  name: "analyze_archived_bars",
  description: "Compute a factor, SMA backtest, or risk metrics from one immutable daily-bar response the app observed by observed_before. Explicit price window and UTC cutoff required. No live provider, current cache head, or account data. App observation does not prove provider publication, adjustment, or complete trading days.",
  label: "Archive Analysis",
  parameters: ArchivedAnalysis,
  executionMode: "sequential",
  async execute(id: string, args: ArchivedAnalysisArgs, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    try { normalizeSymbol(args.symbol, args.market); }
    catch { return err("INPUT_INVALID_SYMBOL", "Symbol must match the declared market."); }
    try { validateObservationCutoff(args.observed_before); }
    catch { return err("DATA_INVALID_OBSERVATION_CUTOFF"); }
    try { validateDateRange(args.start, args.end); }
    catch { return err("INPUT_INVALID_ANALYSIS_PARAMETERS", "start/end must be real YYYY-MM-DD dates in ascending order."); }
    const irrelevant: readonly (keyof ArchivedAnalysisArgs)[] = args.analysis === "factor"
      ? ["fast", "slow", "cash", "commission", "stamp_duty"]
      : args.analysis === "backtest" ? ["factor", "period"]
        : ["factor", "period", "fast", "slow", "cash", "commission", "stamp_duty"];
    if (irrelevant.some(key => args[key] !== undefined))
      return err("INPUT_INVALID_ANALYSIS_PARAMETERS", `Parameters for another analysis mode were supplied with analysis=${args.analysis}.`);

    try {
      const loadBars = createArchiveAnalysisBarsLoader({ symbol: args.symbol, market: args.market,
        start: args.start, end: args.end, observedBefore: args.observed_before, source: args.source });
      const tools = createPriceAnalysisTools(loadBars);
      let result: AgentToolResult<unknown>;
      if (args.analysis === "factor") {
        if (!args.factor) return err("INPUT_INVALID_ANALYSIS_PARAMETERS", "factor is required when analysis=factor.");
        result = await tools.computeFactorTool.execute(id, { symbol: args.symbol, factor: args.factor, period: args.period,
          start: args.start, end: args.end }, signal);
      } else if (args.analysis === "backtest") {
        result = await tools.runBacktestTool.execute(id, { symbol: args.symbol, fast: args.fast, slow: args.slow, cash: args.cash,
          commission: args.commission, stamp_duty: args.stamp_duty, start: args.start, end: args.end }, signal);
      } else {
        result = await tools.checkRiskTool.execute(id, { symbol: args.symbol, start: args.start, end: args.end }, signal);
      }
      signal?.throwIfAborted();
      const details = result.details && typeof result.details === "object" ? result.details as Record<string, unknown> : {};
      return { ...result,
        content: result.content.map(part => part.type === "text" ? { ...part,
          text: `Archive cutoff ${args.observed_before} · app-observed response only; provider publication and trading-day completeness unverified\n${part.text}` } : part),
        details: { ...details, analysis: args.analysis, archiveRequest: { symbol: args.symbol, market: args.market,
          source: args.source ?? "configured source", start: args.start, end: args.end, observedBefore: args.observed_before },
          historicalBoundary: { observedBefore: args.observed_before, evidence: "app-archive" } } };
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof MissingArchiveAnalysisData) return err("DATA_NO_ASOF_ARCHIVE");
      if (error instanceof Error && error.message.includes("archive unavailable")) return err("DATA_ASOF_ARCHIVE_UNAVAILABLE");
      throw error;
    }
  },
};
