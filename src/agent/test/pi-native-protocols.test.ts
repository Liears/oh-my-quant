import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DEFAULT_SETTINGS, type ModelProtocol } from "../../types/config.ts";
import { mapPiConnection } from "../src/pi-config-import.ts";
import { modelProtocols, resolveConfiguredAuth, resolveConfiguredModel } from "../src/model-config.ts";
import { completeSimple, getModels, getProviders } from "../src/kernel/llm.ts";

const providers = ["amazon-bedrock", "azure", "google-vertex", "mistral"];

it("imports every model in the installed API-key provider catalog without changing its identity or native protocol", () => {
  for (const provider of getProviders().filter(item => item.auth.apiKey)) for (const original of provider.getModels()) {
    const mapped = mapPiConnection({ models: {}, auth: {}, settings: { defaultProvider: provider.id, defaultModel: original.id } }, structuredClone(DEFAULT_SETTINGS), {}, {});
    const resolved = resolveConfiguredModel(mapped.draft);
    expect(resolved.provider).toBe(provider.id); expect(resolved.id).toBe(original.id);
    expect(resolved.api).toBe(original.api); expect(resolved.baseUrl).toBe(original.baseUrl);
  }
});

it.each(providers)("imports %s with its original native transport and builds a real Pi request", async provider => {
  const catalog = getModels(provider)[0]!;
  const env = provider === "amazon-bedrock" ? { AWS_PROFILE: "fixture-profile", AWS_REGION: "us-east-1" }
    : provider === "azure" ? { AZURE_OPENAI_BASE_URL: "https://fixture.openai.azure.com/openai/v1", AZURE_OPENAI_API_VERSION: "2025-04-01-preview" }
    : {};
  const mapped = mapPiConnection({ models: { providers: { [provider]: { modelOverrides: { [catalog.id]: { name: "Imported native model" } } } } },
    auth: { [provider]: { type: "api_key", ...(provider === "amazon-bedrock" ? {} : { key: "fixture-key" }), env } },
    settings: { defaultProvider: provider, defaultModel: catalog.id, defaultThinkingLevel: "off" } }, structuredClone(DEFAULT_SETTINGS), {}, {});
  const model = resolveConfiguredModel(mapped.draft), auth = await resolveConfiguredAuth(mapped.draft, model, {});
  expect(model).toMatchObject({ provider, id: catalog.id, api: catalog.api, name: "Imported native model" });
  expect(modelProtocols(provider).some(api => api === catalog.api)).toBe(true);
  expect(modelProtocols("custom").some(api => api === catalog.api)).toBe(false);
  expect(auth).toBeDefined();
  expect(auth!.auth.apiKey).toBe(provider === "amazon-bedrock" ? undefined : "fixture-key");
  let payload: Record<string, unknown> | undefined;
  const result = await completeSimple(model, { messages: [{ role: "user", content: "fixture", timestamp: 0 }] }, {
    ...auth!.auth, env: auth!.env,
    onPayload: value => { payload = value as Record<string, unknown>; throw new Error("fixture stops before network"); },
  });
  expect(payload).toBeDefined();
  expect(payload![provider === "amazon-bedrock" ? "modelId" : "model"]).toBe(catalog.id);
  expect(result.errorMessage).toContain("fixture stops before network");
});

it("preserves Vertex service-account metadata without converting ADC into an API key", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-native-adc-")), file = join(root, "fixture-credentials.json");
  writeFileSync(file, JSON.stringify({ type: "service_account", project_id: "fixture-project" }));
  try {
    const provider = "google-vertex", model = getModels(provider)[0]!.id;
    const mapped = mapPiConnection({ models: {}, auth: { [provider]: { type: "api_key", env: {
      GOOGLE_APPLICATION_CREDENTIALS: file, GOOGLE_CLOUD_PROJECT: "fixture-project", GOOGLE_CLOUD_LOCATION: "us-central1",
    } } }, settings: { defaultProvider: provider, defaultModel: model } }, structuredClone(DEFAULT_SETTINGS), {}, {});
    const auth = await resolveConfiguredAuth(mapped.draft, undefined, {});
    expect(auth!.auth.apiKey).toBeUndefined();
    expect(auth!.env).toMatchObject({ GOOGLE_APPLICATION_CREDENTIALS: file, GOOGLE_CLOUD_PROJECT: "fixture-project", GOOGLE_CLOUD_LOCATION: "us-central1" });
    let called = false;
    const result = await completeSimple(resolveConfiguredModel(mapped.draft), { messages: [{ role: "user", content: "fixture", timestamp: 0 }] }, {
      ...auth!.auth, env: auth!.env, onPayload: () => { called = true; throw new Error("fixture ADC stop"); },
    });
    expect(called).toBe(true); expect(result.errorMessage).toContain("fixture ADC stop");
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected ADC fixture root.");
    rmSync(root, { recursive: true, force: true });
  }
});

it.each(providers)("sends %s auth and its native route to a local fixture endpoint", async provider => {
  let received: { path: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    received = { path: new URL(request.url).pathname, headers: Object.fromEntries(request.headers), body: await request.json() as Record<string, unknown> };
    return Response.json({ error: { message: "fixture endpoint stop", code: "fixture" }, message: "fixture endpoint stop" }, { status: 400 });
  } });
  const proxy = process.env.NO_PROXY; process.env.NO_PROXY = "127.0.0.1,localhost";
  try {
    const catalog = getModels(provider)[0]!;
    const env = provider === "amazon-bedrock" ? {
      AWS_ACCESS_KEY_ID: "FIXTUREACCESS", AWS_SECRET_ACCESS_KEY: "fixture-secret", AWS_REGION: "us-east-1", AWS_BEDROCK_FORCE_HTTP1: "1",
    } : {};
    const mapped = mapPiConnection({ models: { providers: { [provider]: { baseUrl: `${server.url}${provider}`, headers: { "x-fixture": provider } } } },
      auth: { [provider]: { type: "api_key", ...(provider === "amazon-bedrock" ? {} : { key: "fixture-key" }), env } },
      settings: { defaultProvider: provider, defaultModel: catalog.id, defaultThinkingLevel: "off" } }, structuredClone(DEFAULT_SETTINGS), {}, {});
    const auth = await resolveConfiguredAuth(mapped.draft, undefined, {});
    const result = await completeSimple(resolveConfiguredModel(mapped.draft), { messages: [{ role: "user", content: "fixture", timestamp: 0 }] }, {
      ...auth!.auth, env: auth!.env, signal: AbortSignal.timeout(5000),
    });
    expect(result.stopReason).toBe("error");
    expect(received).toBeDefined();
    expect(received!.path).toContain(provider);
    expect(received!.headers["x-fixture"]).toBe(provider);
    if (provider === "amazon-bedrock") {
      expect(received!.headers.authorization).toContain("AWS4-HMAC-SHA256 Credential=FIXTUREACCESS/");
      expect(received!.path).toContain("converse-stream");
    } else if (provider === "azure") {
      expect(received!.headers["api-key"]).toBe("fixture-key"); expect(received!.path).toContain("responses");
    } else if (provider === "google-vertex") {
      expect(received!.headers["x-goog-api-key"]).toBe("fixture-key"); expect(received!.path).toContain("streamGenerateContent");
    } else {
      expect(received!.headers.authorization).toBe("Bearer fixture-key"); expect(received!.path).toContain("v1/chat/completions");
    }
  } finally { server.stop(true); if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy; }
}, 10000);

it("rejects unsupported custom transports and API-key impersonation of an OAuth-only provider", () => {
  const api: ModelProtocol = "bedrock-converse-stream";
  expect(() => mapPiConnection({ models: { providers: { desk: { api, baseUrl: "http://localhost:1234", models: [{ id: "model" }] } } }, auth: {}, settings: {} },
    structuredClone(DEFAULT_SETTINGS), { provider: "desk", model: "model" }, {})).toThrow("original provider identity");
  expect(() => resolveConfiguredModel({ ...structuredClone(DEFAULT_SETTINGS), provider: "custom", model: "model", providers: { custom: { api, baseUrl: "http://localhost:1234" } } })).toThrow("supported by this provider");
  expect(() => mapPiConnection({ models: {}, auth: { "openai-codex": { type: "api_key", key: "wrong-auth-kind" } }, settings: {} },
    structuredClone(DEFAULT_SETTINGS), { provider: "openai-codex", model: getModels("openai-codex")[0]!.id }, {})).toThrow("requires OAuth");
});
