import { expect, it } from "bun:test";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { mapPiConnection, type PiConfigInput } from "../src/pi-config-import.ts";
import { resolveConfiguredAuth, resolveConfiguredModel } from "../src/model-config.ts";
import { validateModelCompat } from "../src/model-metadata.ts";
import { completeSimple } from "../src/kernel/llm.ts";

const target = (model = "fallback-model") => ({ provider: "desk", model, cost: { input: 3, output: 4, cacheRead: 5, cacheWrite: 6,
  tiers: [{ inputTokensAbove: 100, input: 6, output: 8, cacheRead: 10, cacheWrite: 12 }] } });
function input(fallbacks: readonly unknown[] = [target()]): PiConfigInput {
  return { models: { providers: { desk: { api: "anthropic-messages", baseUrl: "http://localhost:1234",
    models: [{ id: "primary-model", compat: { allowedFallbackModels: fallbacks }, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }],
  } } }, auth: { desk: { type: "api_key", key: "fixture-key" } }, settings: { defaultProvider: "desk", defaultModel: "primary-model", defaultThinkingLevel: "off" } };
}

it("retains ordered fallback targets and replaces the whole list at model override precedence", () => {
  const source = input([target("first"), target("second")]);
  const providers = (source.models as { providers: Record<string, Record<string, unknown>> }).providers;
  providers.desk!.compat = { allowedFallbackModels: [target("provider-default")] };
  providers.desk!.modelOverrides = { "primary-model": { compat: { allowedFallbackModels: [target("override")] } } };
  const mapped = mapPiConnection(source, structuredClone(DEFAULT_SETTINGS), {}, {});
  const resolved = resolveConfiguredModel(mapped.draft);
  expect(resolved.compat).toMatchObject({ allowedFallbackModels: [target("override")] });
  expect(mapped.summary.metadata.compatibilityFields).toContain("allowedFallbackModels");
  expect(JSON.stringify(mapped.summary)).not.toContain("fixture-key");
  const untouched = mapPiConnection(input([target("first"), target("second")]), structuredClone(DEFAULT_SETTINGS), {}, {});
  expect(resolveConfiguredModel(untouched.draft).compat).toMatchObject({ allowedFallbackModels: [target("first"), target("second")] });
});

it.each([{ fallbacks: [] }, { fallbacks: [target()] }])("sends fallback model IDs only when configured, with no pricing metadata in the request", async ({ fallbacks }) => {
  const mapped = mapPiConnection(input(fallbacks), structuredClone(DEFAULT_SETTINGS), {}, {});
  let body: Record<string, unknown> | undefined;
  const result = await completeSimple(resolveConfiguredModel(mapped.draft), { messages: [{ role: "user", content: "fixture", timestamp: 0 }] }, {
    apiKey: "fixture-key", onPayload: value => { body = value as Record<string, unknown>; throw new Error("Fixture stops before network"); },
  });
  expect(result.stopReason).toBe("error");
  expect(body).toBeDefined(); expect(body!.fallbacks).toEqual(fallbacks.length ? [{ model: "fallback-model" }] : undefined);
  expect(JSON.stringify(body)).not.toContain("inputTokensAbove");
});

it("uses the actual returned fallback model and its pricing tier in a real Pi HTTP stream", async () => {
  let payload: Record<string, unknown> | undefined;
  const received: { key: string | null } = { key: null };
  const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    payload = await request.json() as Record<string, unknown>; received.key = request.headers.get("x-api-key");
    return new Response([
      event("message_start", { message: { id: "fixture", type: "message", role: "assistant", model: "fallback-model", content: [], stop_reason: null,
        usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } } }),
      event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      event("content_block_delta", { index: 0, delta: { type: "text_delta", text: "fixture fallback result" } }),
      event("content_block_stop", { index: 0 }),
      event("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } }),
      event("message_stop", {}),
    ].join(""), { headers: { "content-type": "text/event-stream" } });
  } });
  const previous = process.env.NO_PROXY; process.env.NO_PROXY = "127.0.0.1,localhost";
  try {
    const mapped = mapPiConnection(input(), structuredClone(DEFAULT_SETTINGS), {}, {});
    mapped.draft.providers!.desk!.baseUrl = server.url.href;
    const model = resolveConfiguredModel(mapped.draft), auth = await resolveConfiguredAuth(mapped.draft);
    const result = await completeSimple(model, { messages: [{ role: "user", content: "fixture", timestamp: 0 }] }, { ...auth!.auth, maxTokens: 30 });
    expect(received.key).toBe("fixture-key"); expect(payload!.fallbacks).toEqual([{ model: "fallback-model" }]);
    expect(result).toMatchObject({ stopReason: "stop", model: "primary-model", responseModel: "fallback-model", content: [{ type: "text", text: "fixture fallback result" }] });
    // 110 total input crosses 100: (100*6 + 10*10 + 20*8) / 1,000,000.
    expect(result.usage.cost.total).toBeCloseTo(0.00086, 10);
    expect(model.id).toBe("primary-model");
  } finally { server.stop(true); if (previous === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previous; }
});

it.each([null, "fallback", [{}], [{ ...target(), model: "" }], [{ ...target(), provider: "bad\nprovider" }],
  [{ ...target(), cost: { input: 1 } }], [{ ...target(), cost: { input: -1, output: 1, cacheRead: 1, cacheWrite: 1 } }],
  [{ ...target(), cost: { ...target().cost, tiers: [{ inputTokensAbove: -1, input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }] } }],
  [{ ...target(), unknown: "private-value" }],
].map(allowedFallbackModels => ({ allowedFallbackModels })))("rejects malformed fallback metadata without leaking configuration values", ({ allowedFallbackModels }) => {
  expect(() => validateModelCompat({ allowedFallbackModels })).toThrow("Invalid or unsupported model compatibility fields");
});
