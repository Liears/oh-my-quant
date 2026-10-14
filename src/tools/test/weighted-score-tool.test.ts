import { expect, test } from "bun:test";
import { calculateWeightedScoreTool } from "../weighted-score-tool.ts";
import { createBuiltinTools, listBuiltinToolCapabilities } from "../registry.ts";
import { inspectToolReadiness } from "../../runtime/data/tool-readiness.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";

const input = { subject: "AURX", observationDate: "2026-09-17", components: [
  { name: "IV rank", score: 78, weight: 0.25 }, { name: "RSI", score: 80, weight: 0.75 },
] };

test("registered production tool returns dated input arithmetic and no fabricated signal calibration", async () => {
  expect(createBuiltinTools().find(tool => tool.name === calculateWeightedScoreTool.name)).toBe(calculateWeightedScoreTool);
  const result = await calculateWeightedScoreTool.execute("score", input);
  expect(result.details).toMatchObject({ basis: "explicit-supplied-score-components", input,
    score: 79.5, roundedScore: 80, largestContributors: ["RSI"] });
  expect(JSON.stringify(result.content)).toContain("2026-09-17");
  expect(JSON.stringify(result.details)).toContain("Does not verify input observations");
});

test("capability has no network, process or storage effects and remains local rather than market-verified", () => {
  const manifest = listBuiltinToolCapabilities().find(tool => tool.name === calculateWeightedScoreTool.name)!;
  expect(manifest.requirements.effects).toEqual([]);
  expect(manifest.parameters.required).toEqual(["subject", "observationDate", "components"]);
  const readiness = inspectToolReadiness(DEFAULT_SETTINGS, { market: "US" }, {}, [manifest])[0]!;
  expect(readiness.status).toBe("local");
  expect(readiness.sample).toBeUndefined();
});

test.each(["2026-02-30", "unknown"])("does not calculate using an invalid observation date %s", async observationDate => {
  expect((await calculateWeightedScoreTool.execute("invalid", { ...input, observationDate })).details)
    .toMatchObject({ error: { code: "INPUT_INVALID_ANALYSIS_PARAMETERS" } });
});

test("rejects missing weights and cancellation without substituting a default score", async () => {
  expect((await calculateWeightedScoreTool.execute("missing", { ...input, components: input.components.slice(0, 1) })).details)
    .toMatchObject({ error: { code: "INPUT_INVALID_ANALYSIS_PARAMETERS" } });
  const controller = new AbortController(); controller.abort();
  await expect(calculateWeightedScoreTool.execute("cancel", input, controller.signal)).rejects.toThrow();
});
