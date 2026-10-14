import { strictEqual, ok } from "node:assert";
import { getModels, streamSimple } from "../../../src/agent/src/kernel/llm.ts";
import { resolveConfiguredModel } from "../../../src/agent/src/model-config.ts";
import { resolveModelOAuth } from "../../../src/agent/src/model-oauth.ts";
import { ModelOAuthFile } from "../../../src/storage/index.ts";

const mode = process.argv[2];
if (mode === "catalog") {
  ok(getModels("anthropic").length > 0);
  strictEqual(resolveConfiguredModel({ provider: "openai", model: "gpt-4o", env: {}, thinkingLevel: "off" }).id, "gpt-4o");
} else if (mode === "oauth") {
  const file = ModelOAuthFile.create("anthropic", { type: "oauth", access: "fixture-access", refresh: "fixture-refresh", expires: Date.now() + 3600000 });
  const result = await resolveModelOAuth("anthropic", file.id);
  ok(result.auth.apiKey === "fixture-access" || Object.values(result.auth.headers ?? {}).some(value => value?.includes("fixture-access")));
} else {
  for (const api of ["anthropic-messages", "openai-completions", "openai-responses", "google-generative-ai"] as const) {
    let payloads = 0;
    const stream = streamSimple({
      api, id: "fixture-model", name: "fixture-model", provider: "custom-fixture",
      baseUrl: "http://127.0.0.1:1", input: ["text"], reasoning: false,
      contextWindow: 8192, maxTokens: 256,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }, { messages: [{ role: "user", content: "fixture", timestamp: 0 }] }, {
      apiKey: "fixture-key", signal: mode === "abort" ? AbortSignal.abort() : AbortSignal.timeout(5000),
      onPayload: () => { payloads++; throw new Error("fixture-before-network"); },
    });
    const events = [];
    for await (const event of stream) events.push(event.type);
    const result = await stream.result();
    strictEqual(events.at(-1), "error");
    if (mode === "abort") strictEqual(result.stopReason, "aborted");
    else { strictEqual(payloads, 1); ok(result.errorMessage?.includes("fixture-before-network")); }
  }
}
console.log(JSON.stringify({ ok: true, mode }));
