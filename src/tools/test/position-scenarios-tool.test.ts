import { expect, it } from "bun:test";
import { calculatePositionScenariosTool } from "../position-scenarios-tool.ts";
import { createBuiltinTools, findBuiltinTool, listBuiltinToolCapabilities } from "../registry.ts";
import { inspectToolReadiness } from "../../runtime/data/tool-readiness.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { runAgentLoop } from "../../agent/src/kernel/loop.ts";
import { convertToLlm, createDisplayUserMessage } from "../../agent/src/session-runtime/harness/messages.ts";

const input = { shares: 200, costPerShare: 50, observedClose: 42, observationDate: "2026-09-17", currency: "USD", changes: [0.1] };

it("executes the registered default tool and returns dated, explicit input arithmetic", async () => {
  expect(findBuiltinTool("calculate_position_scenarios")).toBe(calculatePositionScenariosTool);
  expect(createBuiltinTools().find(tool => tool.name === calculatePositionScenariosTool.name)).toBe(calculatePositionScenariosTool);
  const result = await calculatePositionScenariosTool.execute("scenario", input);
  expect(result.details).toMatchObject({ basis: "explicit-supplied-hypothetical-inputs", input,
    scenarios: [{ value: 9240, profitLoss: -760, returnOnCost: -0.076 }] });
});

it("declares no network, account, storage or process prerequisite and does not claim sample verification", () => {
  const manifest = listBuiltinToolCapabilities().find(tool => tool.name === calculatePositionScenariosTool.name)!;
  expect(manifest.requirements.effects).toEqual([]);
  expect(manifest.parameters.required).toEqual(["shares", "costPerShare", "observedClose", "observationDate", "currency", "changes"]);
  const readiness = inspectToolReadiness(DEFAULT_SETTINGS, { market: "US" }, {}, [manifest])[0]!;
  expect(readiness.status).toBe("local");
  expect(readiness.sample).toBeUndefined();
});

it.each(["2026-02-30", "not-a-date"])("rejects invalid supplied close dates: %s", async observationDate => {
  expect((await calculatePositionScenariosTool.execute("invalid", { ...input, observationDate })).details)
    .toMatchObject({ error: { code: "INPUT_INVALID_ANALYSIS_PARAMETERS" } });
});

it("rejects unsupported units and invalid numeric inputs without successful results", async () => {
  for (const args of [{ ...input, currency: "USD/CNY" }, { ...input, shares: NaN }, { ...input, changes: [] }, { ...input, changes: [-1.1] }]) {
    expect((await calculatePositionScenariosTool.execute("invalid", args)).details).toMatchObject({ error: { code: "INPUT_INVALID_ANALYSIS_PARAMETERS" } });
  }
});

it("honors cancellation before calculating", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(calculatePositionScenariosTool.execute("cancelled", input, controller.signal)).rejects.toThrow();
});

it("uses the real Pi loop to project the registered schema, reject invalid arguments and return computed numbers", async () => {
  const model: Model<"openai-completions"> = { id: "scenario-fixture", name: "scenario-fixture", provider: "openai", api: "openai-completions",
    baseUrl: "http://unused.invalid/v1", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 1000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const requests: Context[] = [];
  await runAgentLoop([createDisplayUserMessage("Use supplied hypothetical position inputs only.")],
    { systemPrompt: "scenario arithmetic fixture", messages: [], tools: [calculatePositionScenariosTool] },
    { model, convertToLlm }, () => {}, undefined, (_model, context) => {
      requests.push({ ...context, messages: structuredClone(context.messages), tools: undefined });
      const first = requests.length === 1;
      const message: AssistantMessage = { role: "assistant", api: model.api, model: model.id, provider: model.provider, timestamp: 0,
        stopReason: first ? "toolUse" : "stop", content: first ? [
          { type: "toolCall", id: "valid", name: calculatePositionScenariosTool.name, arguments: input },
          { type: "toolCall", id: "invalid", name: calculatePositionScenariosTool.name, arguments: { ...input, shares: "unknown" } },
        ] : [{ type: "text", text: "P/L relative to cost is -760 USD, -7.6%." }],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream(); stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); return stream;
    });
  expect(requests).toHaveLength(2);
  expect(getCurrentTools(requests[0]!.messages)).toMatchObject([{ name: calculatePositionScenariosTool.name, parameters: calculatePositionScenariosTool.parameters }]);
  const results = requests[1]!.messages.filter(message => message.role === "toolResult");
  expect(results.map(result => [result.toolCallId, result.isError])).toEqual([["valid", false], ["invalid", true]]);
  expect(JSON.stringify(results[0])).toContain('"profitLoss":-760');
  expect(JSON.stringify(results[0])).toContain("2026-09-17");
});
