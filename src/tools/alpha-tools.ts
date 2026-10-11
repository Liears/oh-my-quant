import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { listAlphaRuns } from "../storage/index.ts";
import { createAlphaResearchDeps, runAlphaResearch, restoreAlphaResearch, formatAlphaResearch } from "../runtime/alpha-research.ts";
import { ok } from "./shared/results.ts";

const Backtest = Type.Object({ symbol: Type.String({ minLength: 1 }), start: Type.String({ minLength: 1 }), end: Type.String({ minLength: 1 }),
  fast: Type.Integer({ minimum: 1 }), slow: Type.Integer({ minimum: 2 }), quantity: Type.Integer({ minimum: 1 }),
  cash: Type.Number({ exclusiveMinimum: 0 }), commission: Type.Number({ minimum: 0, exclusiveMaximum: 1 }), slippage: Type.Number({ minimum: 0, exclusiveMaximum: 1 }),
  periods_per_year: Type.Number({ minimum: 1, maximum: 366 }), simulation: Type.Literal("generic-stock-next-open"),
}, { additionalProperties: false });
const History = Type.Object({ id: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false });
const Status = Type.Object({}, { additionalProperties: false });

export function createAlphaTools(deps: { run?: typeof runAlphaResearch; restore?: typeof restoreAlphaResearch; list?: typeof listAlphaRuns;
  check?: ReturnType<typeof createAlphaResearchDeps>["check"] } = {}) {
  const alphaBacktestTool: AgentTool<typeof Backtest> = {
    name: "alpha_backtest", label: "Alpha backtest", parameters: Backtest, executionMode: "sequential",
    description: "Run AKQuant SMA research using fixed-quantity integer shares and next-open fills. Checks the configured Python engine before fetching daily OHLC, validates the fill/cash ledger and saves a versioned research run. Requires explicit window, hypothetical cash/quantity, commission, slippage and annualization assumptions. Generic T+0 stock simulation; no real market trading rules, dividends, taxes or orders. Do not substitute the next-close run_backtest tool when AKQuant is unavailable; report the dependency failure.",
    async execute(_id, args, signal) {
      const artifact = await (deps.run ?? runAlphaResearch)(args, signal);
      return ok(formatAlphaResearch(artifact), artifact);
    },
  };
  const alphaRunsTool: AgentTool<typeof History> = {
    name: "alpha_runs", label: "Alpha runs", parameters: History, executionMode: "sequential",
    description: "List saved alpha research IDs or load an ID and verify its original DatasetRef, request, fills, ledger and metrics. Does not call Python, refresh prices or rerun the matching engine. Corrupt/missing archives remain visible as unavailable; no account data.",
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      if (args.id) {
        const artifact = (deps.restore ?? restoreAlphaResearch)(args.id);
        return ok(`${formatAlphaResearch(artifact)}\nHistorical receipts and ledger verified; engine not rerun.`, artifact);
      }
      const data = (deps.list ?? listAlphaRuns)();
      return ok([...data.items.map(item => `${item.id} · ${item.symbol} · ${item.createdAt}`),
        ...(data.items.length ? [] : ["No saved alpha runs."]), `Unavailable files: ${data.unavailable.length}`].join("\n"), data);
    },
  };
  const alphaEngineStatusTool: AgentTool<typeof Status> = {
    name: "alpha_engine_status", label: "Alpha engine status", parameters: Status, executionMode: "sequential",
    description: "Check the explicitly configured AKQuant Python environment and pinned API/rule versions. Does not fetch market data, run a strategy, install packages or write settings. If not configured, user sets WHYJ_QUANT_AKQUANT_PYTHON; executable paths cannot be supplied by tool arguments.",
    async execute(_id, _args, signal) {
      signal?.throwIfAborted();
      const status = await (deps.check ?? createAlphaResearchDeps().check)(signal);
      signal?.throwIfAborted();
      return ok(`AKQuant: ${status.status} · required ${status.requiredVersion}\nPython: ${status.python ?? "unchecked"} · package ${status.version ?? "unchecked"} · rules ${status.ruleVersion ?? "unchecked"}\nConfigure WHYJ_QUANT_AKQUANT_PYTHON; setup and verification: docs/alpha-backtest.md. Ready means import/version checked, not a research run.`, status);
    },
  };
  return { alphaBacktestTool, alphaRunsTool, alphaEngineStatusTool };
}
export const ALPHA_TOOLS: AgentTool[] = Object.values(createAlphaTools());
