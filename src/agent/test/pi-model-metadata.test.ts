import { expect, it } from "bun:test";
import { calculateCost, type Usage } from "@earendil-works/pi-ai";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { mapPiConnection, type PiConfigInput } from "../src/pi-config-import.ts";
import { configuredThinking, configuredThinkingLevels, resolveConfiguredAuth, resolveConfiguredModel } from "../src/model-config.ts";
import { completeSimple, getModels } from "../src/kernel/llm.ts";
import { validateModelCompat } from "../src/model-metadata.ts";

function fixture(): PiConfigInput {
  return { models: { providers: { desk: {
    name: "Research Desk", api: "openai-completions", baseUrl: "http://localhost:1234/v1", apiKey: "api-secret", authHeader: true,
    headers: { "x-tenant": "$TENANT", "x-layer": "provider" },
    compat: { supportsStore: false, supportsUsageInStreaming: false, maxTokensField: "max_tokens", openRouterRouting: { order: ["first"], only: ["first", "second"] } },
    models: [{ id: "model", name: "Definition", reasoning: true, thinkingLevelMap: { high: null, max: "medium" },
      headers: { "x-layer": "definition", "x-model": "model-secret" },
      samplingParams: { temperature: 0.2, top_k: 20 }, compat: { openRouterRouting: { order: ["second"] } },
      cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 100, input: 3, output: 4, cacheRead: 5, cacheWrite: 6 }] },
    }],
    modelOverrides: { model: { name: "Override", contextWindow: 64000, maxTokens: 400, thinkingLevelMap: { low: "low" },
      samplingParams: { top_k: 30 }, headers: { "x-layer": "override", "x-override": "yes" },
      compat: { openRouterRouting: { only: ["second"] } }, cost: { output: 7 },
    } },
  } } }, auth: {}, settings: { defaultProvider: "desk", defaultModel: "model", defaultThinkingLevel: "max" } };
}

it("applies modelOverrides after definitions, merges nested metadata, and keeps preview free of header values", async () => {
  const original = fixture();
  const before = structuredClone(original);
  const mapped = mapPiConnection(original, structuredClone(DEFAULT_SETTINGS), {}, { TENANT: "tenant-secret" });
  const model = resolveConfiguredModel(mapped.draft);
  expect(model).toMatchObject({ name: "Override", contextWindow: 64000, maxTokens: 400,
    samplingParams: { temperature: 0.2, top_k: 30 }, thinkingLevelMap: { high: null, max: "medium", low: "low" },
    compat: { supportsStore: false, openRouterRouting: { order: ["second"], only: ["second"] } },
    cost: { output: 7, tiers: [{ inputTokensAbove: 100, input: 3, output: 4 }] },
  });
  expect(configuredThinking(mapped.draft)).toBe("max");
  expect(configuredThinkingLevels(mapped.draft)).not.toContain("high");
  const auth = await resolveConfiguredAuth(mapped.draft);
  expect(auth!.auth.headers).toMatchObject({ authorization: "Bearer api-secret", "x-tenant": "tenant-secret", "x-layer": "definition", "x-override": "yes" });
  expect(JSON.stringify(mapped.summary)).not.toContain("secret");
  expect(original).toEqual(before);
  model.samplingParams!.top_k = 999;
  expect(resolveConfiguredModel(mapped.draft).samplingParams!.top_k).toBe(30);
});

it("delivers header, sampling, thinking and compatibility settings through an actual Pi HTTP request", async () => {
  let received: { headers: Record<string, string>; body: Record<string, unknown> } | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    received = { headers: Object.fromEntries(request.headers), body: await request.json() as Record<string, unknown> };
    return new Response('data: {"id":"fixture","object":"chat.completion.chunk","created":0,"model":"model","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","created":0,"model":"model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
  } });
  const proxy = process.env.NO_PROXY; process.env.NO_PROXY = "127.0.0.1,localhost";
  try {
    const mapped = mapPiConnection(fixture(), structuredClone(DEFAULT_SETTINGS), {}, { TENANT: "tenant-secret" });
    mapped.draft.providers!.desk!.baseUrl = `${server.url}v1`;
    const model = resolveConfiguredModel(mapped.draft), auth = await resolveConfiguredAuth(mapped.draft);
    const level = configuredThinking(mapped.draft);
    const reply = await completeSimple(model, { systemPrompt: "fixture system", messages: [{ role: "user", content: "fixture", timestamp: 0 }] }, {
      ...auth!.auth, env: auth!.env, reasoning: level === "off" ? undefined : level, temperature: 0.9, maxTokens: 42,
    });
    expect(reply.stopReason).toBe("stop");
    expect(received!.headers).toMatchObject({ authorization: "Bearer api-secret", "x-tenant": "tenant-secret", "x-layer": "definition", "x-model": "model-secret" });
    expect(received!.body).toMatchObject({ model: "model", temperature: 0.2, top_k: 30, max_tokens: 42, reasoning_effort: "medium" });
    expect(received!.body.store).toBeUndefined(); expect(received!.body.stream_options).toBeUndefined();
    expect(received!.body.max_completion_tokens).toBeUndefined();
  } finally { server.stop(true); if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy; }
});

it("retains native per-model protocol and endpoint when importing only built-in overrides", () => {
  const original = getModels("openai").find(model => model.id === "gpt-4o-mini")!;
  const mapped = mapPiConnection({ models: { providers: { openai: { api: "anthropic-messages", modelOverrides: { [original.id]: { samplingParams: { top_p: 0.3 }, thinkingLevelMap: { max: null } } } } } },
    auth: {}, settings: { defaultProvider: "openai", defaultModel: original.id } }, structuredClone(DEFAULT_SETTINGS), {}, {});
  expect(resolveConfiguredModel(mapped.draft)).toMatchObject({ api: original.api, baseUrl: original.baseUrl, samplingParams: { top_p: 0.3 } });
  expect(mapped.draft.providers!.openai!.baseUrl).toBeUndefined();
});

it("uses explicit model URLs and lets sibling models inherit a changed provider URL", () => {
  const mapped = mapPiConnection({ models: { providers: { desk: { api: "openai-completions", baseUrl: "http://localhost:1234/v1",
    models: [{ id: "special", baseUrl: "http://localhost:2345/v1" }, { id: "normal" }] } } }, auth: {}, settings: {} },
    structuredClone(DEFAULT_SETTINGS), { provider: "desk", model: "special" }, {});
  mapped.draft.providers!.desk!.baseUrl = "http://localhost:3456/v1";
  expect(resolveConfiguredModel(mapped.draft).baseUrl).toBe("http://localhost:2345/v1");
  expect(resolveConfiguredModel({ ...mapped.draft, model: "normal" }).baseUrl).toBe("http://localhost:3456/v1");
});

it("merges request headers case-insensitively and requires real credentials for authHeader", async () => {
  const draft = mapPiConnection(fixture(), structuredClone(DEFAULT_SETTINGS), {}, { TENANT: "fixture" }).draft;
  draft.providers!.desk!.headers = { AUTHORIZATION: "wrong", "X-Layer": "provider" };
  draft.providers!.desk!.models!.model!.headers = { authorization: "model-auth", "x-layer": "model" };
  expect((await resolveConfiguredAuth(draft))!.auth.headers).toEqual({ authorization: "model-auth", "x-layer": "model" });
  delete draft.providers!.desk!.apiKey;
  await expect(resolveConfiguredAuth(draft)).rejects.toThrow("resolved API key");
});

it("uses Pi pricing tiers at the exact threshold and accounts for cached input", () => {
  const model = resolveConfiguredModel(mapPiConnection(fixture(), structuredClone(DEFAULT_SETTINGS), {}, { TENANT: "fixture" }).draft);
  const usage: Usage = { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  expect(calculateCost(model, usage).total).toBeCloseTo(0.0001, 10);
  usage.cacheRead = 1; usage.totalTokens = 101;
  expect(calculateCost(model, usage).total).toBeCloseTo(0.000305, 10);
});

it.each(["openai-responses", "anthropic-messages"])("applies %s compatibility in Pi's request builder", async api => {
  const input: PiConfigInput = { models: { providers: { desk: { api, baseUrl: "http://localhost:1234/v1",
    models: [{ id: "model", reasoning: true, thinkingLevelMap: { max: "medium" }, samplingParams: { temperature: 0.2 },
      compat: api === "openai-responses" ? { supportsMaxOutputTokens: false, supportsDeveloperRole: false }
        : { supportsTemperature: false, forceAdaptiveThinking: true },
    }] } } }, auth: {}, settings: { defaultThinkingLevel: "max" } };
  const draft = mapPiConnection(input, structuredClone(DEFAULT_SETTINGS), { provider: "desk", model: "model" }, {}).draft;
  const level = configuredThinking(draft);
  let body: Record<string, unknown> | undefined;
  await completeSimple(resolveConfiguredModel(draft), { systemPrompt: "fixture", messages: [{ role: "user", content: "fixture", timestamp: 0 }] }, {
    apiKey: "fixture", reasoning: level === "off" ? undefined : level, temperature: 0.9, maxTokens: 42,
    onPayload: value => { body = value as Record<string, unknown>; throw new Error("fixture stop before network"); },
  });
  if (api === "openai-responses") {
    expect(body!.max_output_tokens).toBeUndefined();
    expect(body).toMatchObject({ temperature: 0.2, input: [{ role: "system" }, { role: "user" }] });
  } else {
    expect(body!.temperature).toBeUndefined();
    expect(body).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
  }
});

it.each([
  { supportsStore: "false" }, { maxTokensField: "bad" }, { openRouterRouting: { only: "one" } },
  { chatTemplateKwargs: { thinking: { $var: "secret" } } }, { unknownFlag: true },
  { supportsToolReferences: true }, { deferredToolsMode: "kimi" }, { supportsMidConvoSystemMessages: "true" },
])("rejects invalid compatibility settings without echoing their content", value => {
  expect(() => validateModelCompat(value)).toThrow("Invalid or unsupported");
});

it("imports Pi transcript capability flags without dropping model overrides", () => {
  const input = fixture();
  const providers = (input.models as { providers: Record<string, Record<string, unknown>> }).providers;
  providers.desk!.compat = { supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true };
  providers.desk!.modelOverrides = { model: { compat: { supportsMidConvoToolAdditions: false, supportsMidConvoToolChanges: true } } };
  const mapped = mapPiConnection(input, structuredClone(DEFAULT_SETTINGS), {}, { TENANT: "fixture" });
  expect(resolveConfiguredModel(mapped.draft).compat).toMatchObject({
    supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: false, supportsMidConvoToolChanges: true,
  });
});

it.each([
  { thinkingLevelMap: { high: 1 } }, { samplingParams: [] }, { cost: { input: -1 } },
  { cost: { tiers: [{ inputTokensAbove: 100, input: 2 }] } }, { headers: { "bad header": "secret" } },
  { headers: { valid: "!echo secret" } }, { headers: { valid: "value\nsecret" } }, { api: "openai-responses" },
])("rejects malformed modelOverrides before saving", override => {
  const input: PiConfigInput = { models: { providers: { desk: { api: "openai-completions", baseUrl: "http://localhost:1234/v1", models: [{ id: "model" }], modelOverrides: { model: override } } } }, auth: {}, settings: {} };
  expect(() => mapPiConnection(input, structuredClone(DEFAULT_SETTINGS), { provider: "desk", model: "model" }, {})).toThrow();
});
