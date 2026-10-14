import { Type, type Static } from "typebox";
import type { AgentTool } from "../agent/src/session-runtime/index.ts";
import { calculatePositionScenarios } from "../quant/index.ts";
import { isDailyDate } from "../market/bars.ts";
import { ok, err } from "./shared/results.ts";

const Parameters = Type.Object({
  shares: Type.Number({ exclusiveMinimum: 0, description: "Explicitly supplied hypothetical long-position share count; fractional shares allowed" }),
  costPerShare: Type.Number({ exclusiveMinimum: 0, description: "Explicitly supplied cost per share, in the declared currency" }),
  observedClose: Type.Number({ exclusiveMinimum: 0, description: "Supplied historical close, not a live quote" }),
  observationDate: Type.String({ description: "Date of the supplied close, YYYY-MM-DD; does not establish freshness" }),
  currency: Type.String({ pattern: "^[A-Z]{3}$", description: "Explicit currency label shared by cost and close; no FX conversion" }),
  changes: Type.Array(Type.Number({ minimum: -1 }), { minItems: 1, maxItems: 32, description: "Scenario price changes relative to the supplied close, as decimals; 0.1 means +10%" }),
}, { additionalProperties: false });

export const calculatePositionScenariosTool: AgentTool<typeof Parameters> = {
  name: "calculate_position_scenarios", label: "Position Scenarios", parameters: Parameters,
  description: "Calculate unhedged stock prices, values and P/L from explicitly supplied hypothetical long-position inputs. P/L and return use cost basis; price change uses supplied close. No account/file access, market data, FX, fees, option payoff or orders. Never invent missing inputs or treat the supplied close as current.",
  async execute(_id, args: Static<typeof Parameters>, signal) {
    signal?.throwIfAborted();
    if (!isDailyDate(args.observationDate) || !/^[A-Z]{3}$/u.test(args.currency) || !args.changes.length)
      return err("INPUT_INVALID_ANALYSIS_PARAMETERS", "Supply a real observation date, one currency label and at least one scenario.");
    try {
      const scenarios = calculatePositionScenarios(args, args.changes);
      const result = { basis: "explicit-supplied-hypothetical-inputs", input: structuredClone(args), scenarios,
        method: "price = supplied close × (1 + change); value = shares × price; P/L = value − shares × cost per share; return on cost = P/L / (shares × cost per share)",
        limitations: "No live quote, account verification, fees, FX conversion, option payoff or executed hedge. Values use the supplied observation date and currency only." };
      return ok(JSON.stringify(result), result);
    } catch {
      return err("INPUT_INVALID_ANALYSIS_PARAMETERS", "Supplied position/scenario inputs must be finite and positive; price changes cannot be below -100%, overflow or exceed 32 rows.");
    }
  },
};
