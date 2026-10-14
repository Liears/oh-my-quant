import { Type, type Static } from "typebox";
import type { AgentTool } from "../agent/src/session-runtime/index.ts";
import { calculateWeightedScore } from "../quant/index.ts";
import { isDailyDate } from "../market/bars.ts";
import { ok, err } from "./shared/results.ts";

const Parameters = Type.Object({
  subject: Type.String({ minLength: 1, maxLength: 80, description: "Supplied score subject or ticker; no lookup" }),
  observationDate: Type.String({ description: "Date shared by the supplied score snapshot, YYYY-MM-DD; not proof of freshness" }),
  components: Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 80 }),
    score: Type.Number({ minimum: 0, maximum: 100, description: "Already supplied component score; never invent a raw-value-to-score mapping" }),
    weight: Type.Number({ minimum: 0, maximum: 1, description: "Fractional weight, e.g. 0.2 for 20%; all weights must sum to one" }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 64 }),
}, { additionalProperties: false });

export const calculateWeightedScoreTool: AgentTool<typeof Parameters> = {
  name: "calculate_weighted_score", label: "Weighted Score", parameters: Parameters,
  description: "Calculate supplied component score × fractional weight, composite total, rounded total and largest weighted contributors. Use for supplied fear-score or other 0..100 score components before explaining their drivers. Highest unweighted score need not have the largest contribution. No IO, raw signal scoring, missing-data fallback, calibration, forecast or trade recommendation.",
  async execute(_id, args: Static<typeof Parameters>, signal) {
    signal?.throwIfAborted();
    if (!args.subject.trim() || args.subject.length > 80 || !isDailyDate(args.observationDate)) {
      return err("INPUT_INVALID_ANALYSIS_PARAMETERS", "Supply a score subject and valid observation date.");
    }
    try {
      const calculation = calculateWeightedScore(args.components);
      const result = { basis: "explicit-supplied-score-components", input: structuredClone(args), ...calculation,
        method: "contribution = supplied score × fractional weight; total = sum(contributions); rounded total = nearest integer; largest contributors include floating-point ties",
        limitations: "Only arithmetic on the declared snapshot. Does not verify input observations, raw signal scoring, current conditions, calibration, reversal evidence or trading suitability. Preserve supplied consecutive-day and other input meanings separately." };
      return ok(JSON.stringify(result), result);
    } catch {
      return err("INPUT_INVALID_ANALYSIS_PARAMETERS", "Supply 1..64 uniquely named finite scores in 0..100 and fractional weights summing to one. Missing inputs are not filled or normalized.");
    }
  },
};
