import { describe, expect, it } from "bun:test";
import { DEFAULT_SETTINGS, type OhQuantSettings } from "../../types/config.ts";
import { getModels, completeSimple } from "../src/kernel/llm.ts";
import {
  configuredThinking, configuredThinkingLevels, createModelSettingsDraft,
  resolveConfiguredAuth, resolveConfiguredModel, validateModelBaseUrl,
  modelProviders, providerModels,
} from "../src/model-config.ts";
import { selectModelProvider } from "../../runtime/models/model-settings.ts";

function settings(provider: string, model = getModels(provider)[0]!.id): OhQuantSettings {
  return { ...structuredClone(DEFAULT_SETTINGS), provider, model, providers: {} };
}

describe("Pi model connections", () => {
  it("can resolve every model exposed by the pinned provider picker", () => {
    for (const provider of modelProviders()) for (const model of providerModels(provider.id)) {
      const resolved = resolveConfiguredModel(settings(provider.id, model.id));
      expect(resolved.maxTokens).toBeLessThanOrEqual(resolved.contextWindow);
      expect(resolved.id).toBe(model.id);
    }
  });
  it.each([
    ["openai", "openai-responses", "https://api.openai.com/v1"],
    ["google", "google-generative-ai", "https://generativelanguage.googleapis.com/v1beta"],
    ["deepseek", "openai-completions", "https://api.deepseek.com"],
    ["minimax-cn", "anthropic-messages", "https://api.minimaxi.com/anthropic"],
  ])("uses the %s catalog's native protocol and endpoint", (provider, api, baseUrl) => {
    const cfg = settings(provider);
    cfg.env = { WHYJ_QUANT_BASE_URL: "https://old.invalid/anthropic", WHYJ_DEFAULT_SONNET_MODEL: "legacy-model" };
    expect(resolveConfiguredModel(cfg)).toMatchObject({ id: cfg.model, provider, api, baseUrl });
  });

  it("does not infer protocol from a custom URL ending in /v1", () => {
    const cfg = settings("openai");
    cfg.providers = { openai: { baseUrl: "https://proxy.invalid/v1" } };
    expect(resolveConfiguredModel(cfg).api).toBe("openai-responses");
    cfg.providers.openai!.api = "anthropic-messages";
    expect(resolveConfiguredModel(cfg).api).toBe("anthropic-messages");
  });

  it("retains exact custom IDs, isolates model capabilities, and leaves the catalog intact", () => {
    const before = structuredClone(getModels("openai"));
    const cfg = settings("openai", "tenant/model[1m]");
    cfg.providers = { openai: { models: { [cfg.model]: { contextWindow: 1_000_000, maxTokens: 12000, reasoning: true } } } };
    expect(resolveConfiguredModel(cfg)).toMatchObject({ id: "tenant/model[1m]", contextWindow: 1_000_000, maxTokens: 12000, reasoning: true });
    cfg.model = before[0]!.id;
    expect(resolveConfiguredModel(cfg)).toEqual(before[0]);
    expect(getModels("openai")).toEqual(before);
  });

  it("validates capability limits and required custom endpoints", () => {
    const cfg = settings("custom", "local-model");
    expect(() => resolveConfiguredModel(cfg)).toThrow("base URL");
    cfg.providers = { custom: { baseUrl: "http://localhost:1234/v1", models: { "local-model": { contextWindow: 10, maxTokens: 11 } } } };
    expect(() => resolveConfiguredModel(cfg)).toThrow("Output limit");
    cfg.providers.custom!.models!["local-model"]!.maxTokens = -1;
    expect(() => resolveConfiguredModel(cfg)).toThrow("positive integer");
  });

  it.each(["file:///key", "https://user:secret@example.com", "https://example.com?key=secret", "https://example.com#key"])("rejects credential-bearing or invalid endpoint %s", url => {
    expect(() => validateModelBaseUrl(url)).toThrow();
  });

  it("clamps thinking to the chosen model's Pi capabilities", () => {
    const cfg = settings("custom", "plain-model");
    cfg.providers = { custom: { baseUrl: "http://localhost:1234/v1" } };
    cfg.thinkingLevel = "max";
    expect(configuredThinkingLevels(cfg)).toEqual(["off"]);
    expect(configuredThinking(cfg)).toBe("off");
    cfg.provider = "openai";
    cfg.model = getModels("openai").find(model => model.reasoning)!.id;
    expect(configuredThinkingLevels(cfg)).toContain(configuredThinking(cfg));
  });

  it("keeps provider credentials independent and remembers each model", async () => {
    const cfg = settings("openai");
    const openaiModel = cfg.model;
    cfg.providers = { openai: { apiKey: "openai-saved" }, deepseek: { apiKey: "deepseek-saved" } };
    cfg.env.WHYJ_QUANT_API_KEY = "legacy-must-not-leak";
    selectModelProvider(cfg, "deepseek");
    expect((await resolveConfiguredAuth(cfg, undefined, {}))?.auth.apiKey).toBe("deepseek-saved");
    selectModelProvider(cfg, "openai");
    expect(cfg.model).toBe(openaiModel);
    expect((await resolveConfiguredAuth(cfg, undefined, { OPENAI_API_KEY: "ambient" }))?.auth.apiKey).toBe("openai-saved");
    delete cfg.providers.openai!.apiKey;
    expect(await resolveConfiguredAuth(cfg, undefined, {})).toBeUndefined();
    expect((await resolveConfiguredAuth(cfg, undefined, { OPENAI_API_KEY: "ambient" }))?.auth.apiKey).toBe("ambient");
  });

  it("passes provider environment and Cloudflare account/gateway configuration through Pi", async () => {
    const cfg = settings("cloudflare-ai-gateway");
    cfg.providers = { "cloudflare-ai-gateway": { apiKey: "cloudflare-key", env: { CLOUDFLARE_ACCOUNT_ID: "fixture-account", CLOUDFLARE_GATEWAY_ID: "fixture-gateway" } } };
    const auth = await resolveConfiguredAuth(cfg, undefined, {});
    expect(auth?.env).toMatchObject({ CLOUDFLARE_ACCOUNT_ID: "fixture-account", CLOUDFLARE_GATEWAY_ID: "fixture-gateway" });
    let endpoint = "";
    await completeSimple(resolveConfiguredModel(cfg), { messages: [{ role: "user", content: "test", timestamp: 0 }] }, {
      ...auth?.auth, env: auth?.env,
      onPayload: (_payload, model) => { endpoint = model.baseUrl; throw new Error("stop before network"); },
    });
    expect(endpoint).toContain("fixture-account/fixture-gateway");
    expect(endpoint).not.toContain("{CLOUDFLARE");
  });

  it("supports ambient-only providers without requiring a URL or a fake API key", async () => {
    const cfg = settings("amazon-bedrock");
    cfg.providers = { "amazon-bedrock": { env: { AWS_PROFILE: "fixture-profile", AWS_REGION: "us-east-1" } } };
    expect(() => resolveConfiguredModel(cfg)).not.toThrow();
    const auth = await resolveConfiguredAuth(cfg, undefined, {});
    expect(auth?.auth.apiKey).toBeUndefined();
    expect(auth?.env?.AWS_PROFILE).toBe("fixture-profile");
  });

  it("keeps Pi's gateway wrapper for a manual model using a protocol absent from the catalog", async () => {
    const cfg = settings("cloudflare-ai-gateway", "workers-ai/fixture-model");
    cfg.providers = { "cloudflare-ai-gateway": { api: "openai-completions", apiKey: "fixture-key",
      baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
      env: { CLOUDFLARE_ACCOUNT_ID: "fixture-account", CLOUDFLARE_GATEWAY_ID: "fixture-gateway" } } };
    const auth = await resolveConfiguredAuth(cfg, undefined, {});
    let endpoint = "";
    const result = await completeSimple(resolveConfiguredModel(cfg), { messages: [{ role: "user", content: "test", timestamp: 0 }] }, {
      ...auth?.auth, env: auth?.env,
      onPayload: (_payload, model) => { endpoint = model.baseUrl; throw new Error("stop before network"); },
    });
    expect(endpoint).toBe("https://gateway.ai.cloudflare.com/v1/fixture-account/fixture-gateway/compat");
    expect(result.errorMessage).toContain("stop before network");
  });

  it("migrates only legacy overrides and does not freeze catalog defaults", () => {
    const cfg = structuredClone(DEFAULT_SETTINGS);
    const draft = createModelSettingsDraft(cfg);
    expect(cfg.provider).toBeUndefined();
    expect(draft.model).toBe("deepseek-v4-pro");
    expect(draft.providers?.deepseek?.models).toBeUndefined();
    cfg.env = { WHYJ_QUANT_BASE_URL: "https://proxy.invalid/anthropic", WHYJ_QUANT_API_KEY: "fixture-key", WHYJ_QUANT_CONTEXT_WINDOW: "1000000" };
    const customDraft = createModelSettingsDraft(cfg);
    expect(resolveConfiguredModel(customDraft)).toMatchObject({ id: "deepseek-v4-pro", api: "anthropic-messages", contextWindow: 1_000_000 });
    expect(customDraft.providers?.anthropic?.apiKey).toBe("fixture-key");
  });

  it.each(["openai", "google", "deepseek", "anthropic"])("builds an actual %s SDK payload with the selected model", async provider => {
    const cfg = settings(provider);
    let payload: unknown;
    const message = await completeSimple(resolveConfiguredModel(cfg), { messages: [{ role: "user", content: "OK", timestamp: 0 }] }, {
      apiKey: "fixture-key", env: {},
      onPayload: value => { payload = value; throw new Error("stop before network"); },
    });
    expect(payload).toMatchObject({ model: cfg.model });
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toContain("stop before network");
  });
});
