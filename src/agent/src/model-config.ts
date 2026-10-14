import type { Api, AuthResult, Model, ProviderAuthInteraction } from "@earendil-works/pi-ai";
export type { AuthPrompt } from "@earendil-works/pi-ai";
import { getModels, getProvider, getProviders, getSupportedThinkingLevels, clampThinkingLevel } from "./kernel/llm.ts";
import { readWhyjEnvValue, stripTerminalControlCodes } from "../../storage/index.ts";
import type { ModelProtocol, ModelProviderSettings, OhQuantSettings } from "../../types/config.ts";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyModelMetadata, validateModelHeaders } from "./model-metadata.ts";
import { resolveModelOAuth } from "./model-oauth.ts";

type ModelSettings = Pick<OhQuantSettings, "model" | "env" | "provider" | "providers" | "thinkingLevel">;
export const MODEL_PROTOCOLS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

/** Native transports retain the provider's own auth and stream wrapper. */
export function modelProtocols(providerId: string): ModelProtocol[] {
  const native = getModels(providerId).map(model => model.api as ModelProtocol);
  return [...new Set<ModelProtocol>([...MODEL_PROTOCOLS, ...native])];
}

export function modelProviders(settings?: ModelSettings) {
  const catalog = getProviders().filter(provider => (provider.auth.apiKey || provider.auth.oauth) && provider.getModels().length).map(provider => ({
    id: provider.id, name: settings?.providers?.[provider.id]?.name ?? provider.name, baseUrl: provider.baseUrl ?? "",
    auth: provider.auth.apiKey?.name ?? provider.auth.oauth!.name,
    canConfigure: Boolean(provider.auth.apiKey?.login), canApiKey: Boolean(provider.auth.apiKey),
    canOAuth: Boolean(provider.auth.oauth), oauthLabel: provider.auth.oauth?.loginLabel ?? provider.auth.oauth?.name,
  }));
  const custom = Object.entries(settings?.providers ?? {}).filter(([id, config]) => id !== "custom" && config.custom === true && !getProvider(id))
    .map(([id, config]) => ({ id, name: config.name ?? id, baseUrl: config.baseUrl ?? "", auth: "Custom endpoint", canConfigure: false, canApiKey: true, canOAuth: false, oauthLabel: undefined }));
  return [...catalog, ...custom].sort((a, b) => a.name.localeCompare(b.name));
}

export async function configureProviderCredentials(providerId: string, interaction: ProviderAuthInteraction) {
  const login = getProvider(providerId)?.auth.apiKey?.login;
  if (!login) throw new Error("This provider uses existing environment credentials. Configure them before starting WhyJ.");
  const credential = await login(interaction);
  interaction.signal.throwIfAborted();
  return credential;
}

export function providerModels(provider: string, settings?: ModelSettings) {
  const catalog = getModels(provider);
  const config = settings?.providers?.[provider];
  const ids = new Set([...catalog.map(model => model.id), ...Object.keys(config?.models ?? {}),
    ...(config?.model ? [config.model] : []), ...(settings?.provider === provider && settings.model ? [settings.model] : [])]);
  return [...ids].map(id => {
    let model = catalog.find(candidate => candidate.id === id);
    if (settings) {
      try { model = resolveConfiguredModel({ ...settings, provider, model: id }); }
      catch { /* Incomplete drafts remain selectable so the user can repair them. */ }
    }
    return model ? {
      id: model.id, name: model.name, api: model.api, contextWindow: model.contextWindow,
      maxTokens: model.maxTokens, reasoning: model.reasoning, input: model.input,
    } : { id, name: id, api: config?.api ?? "openai-completions", contextWindow: 128000, maxTokens: 8192, reasoning: false, input: ["text"] };
  });
}

export function validateModelBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) base URL without credentials, query or fragment.");
  }
  return value.trim().replace(/\/+$/, "");
}

/** Explicit provider/model settings share one resolver across UI, Doctor and requests. */
export function resolveConfiguredModel(settings: ModelSettings): Model<Api> {
  if (!settings.provider) {
    const id = resolveModelId(settings.model, settings.env);
    return resolveModel(inferProvider(id, settings.env), id, settings.env);
  }
  const provider = getProvider(settings.provider);
  const config = settings.providers?.[settings.provider] ?? {};
  const id = settings.model.trim();
  if (!id) throw new Error("Choose a model or enter its exact model ID.");
  if (/[\x00-\x1f\x7f]/.test(id)) throw new Error("Model ID cannot contain control characters.");
  if (!provider && settings.provider !== "custom" && config.custom !== true) throw new Error(`Unknown model provider: ${settings.provider}`);
  const capabilities = config.models?.[id] ?? {};
  const catalog = provider?.getModels().find(candidate => candidate.id === id);
  const known = capabilities.replaceCatalog ? undefined : catalog;
  const api = capabilities.api ?? config.api ?? catalog?.api ?? provider?.getModels()[0]?.api ?? "openai-completions";
  const baseUrl = capabilities.baseUrl?.trim() || config.baseUrl?.trim() || catalog?.baseUrl || provider?.baseUrl
    || provider?.getModels().find(candidate => candidate.api === api)?.baseUrl;
  if (!provider && !baseUrl) throw new Error("Enter a base URL for the custom provider.");
  // Ambient providers such as Bedrock/Vertex let their SDK resolve the endpoint.
  if (baseUrl) validateModelBaseUrl(baseUrl);
  const protocols = modelProtocols(settings.provider);
  if (config.api && !protocols.includes(config.api)) throw new Error("Choose a protocol supported by this provider.");
  if (capabilities.api && !protocols.includes(capabilities.api)) throw new Error("Choose a model protocol supported by this provider.");
  const model: Model<Api> = {
    ...(known ?? {
      id, name: id, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000, maxTokens: 8192,
    }),
    id, provider: settings.provider, api, baseUrl: baseUrl ?? "",
  };
  for (const key of ["contextWindow", "maxTokens"] as const) {
    if (capabilities[key] !== undefined) {
      if (!Number.isSafeInteger(capabilities[key]) || capabilities[key]! <= 0) throw new Error(`${key} must be a positive integer.`);
      model[key] = capabilities[key]!;
    }
  }
  if (model.maxTokens > model.contextWindow) {
    // Some catalog entries report a larger output budget than their total window.
    if (capabilities.contextWindow === undefined && capabilities.maxTokens === undefined) model.maxTokens = model.contextWindow;
    else throw new Error("Output limit cannot exceed context window.");
  }
  if (capabilities.reasoning !== undefined) {
    if (typeof capabilities.reasoning !== "boolean") throw new Error("Reasoning support must be a boolean.");
    model.reasoning = capabilities.reasoning;
  }
  if (capabilities.name !== undefined) {
    if (typeof capabilities.name !== "string" || !capabilities.name.trim() || /[\x00-\x1f\x7f]/.test(capabilities.name)) throw new Error("Invalid model display name.");
    model.name = capabilities.name;
  }
  if (capabilities.input !== undefined) {
    if (!Array.isArray(capabilities.input) || !capabilities.input.length || capabilities.input.some(value => value !== "text" && value !== "image")) throw new Error("Invalid model input types.");
    model.input = [...capabilities.input];
  }
  applyModelMetadata(model, capabilities, config.compat);
  return model;
}

export function configuredThinkingLevels(settings: ModelSettings): string[] {
  return getSupportedThinkingLevels(resolveConfiguredModel(settings));
}

export function configuredThinking(settings: ModelSettings) {
  const requested = ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(settings.thinkingLevel)
    ? settings.thinkingLevel as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" : "off";
  return clampThinkingLevel(resolveConfiguredModel(settings), requested);
}

export async function resolveConfiguredAuth(
  settings: ModelSettings,
  model = resolveConfiguredModel(settings),
  processEnv: Record<string, string | undefined> = process.env,
  signal = new AbortController().signal,
): Promise<AuthResult | undefined> {
  const config = settings.providers?.[model.provider];
  const key = settings.provider ? config?.apiKey : readWhyjEnvValue(settings.env, "apiKey")
    || readWhyjEnvValue(settings.env, "authToken") || readWhyjEnvValue(processEnv, "apiKey") || readWhyjEnvValue(processEnv, "authToken");
  const env = { ...settings.env, ...config?.env };
  signal.throwIfAborted();
  const withHeaders = (result: AuthResult): AuthResult => {
    if (config?.authHeader !== undefined && typeof config.authHeader !== "boolean") throw new Error("Invalid authHeader setting.");
    if (config?.authHeader && (!result.auth.apiKey || (result.source === "No authentication"))) throw new Error("authHeader requires a resolved API key.");
    const headers = Object.fromEntries([
      ...Object.entries(result.auth.headers ?? {}), ...Object.entries(config?.headers ? validateModelHeaders(config.headers) : {}),
      ...(config?.authHeader ? [["Authorization", `Bearer ${result.auth.apiKey}`] as const] : []),
      ...Object.entries(config?.models?.[model.id]?.headers ? validateModelHeaders(config.models[model.id]!.headers) : {}),
    ].map(([name, value]) => [name.toLowerCase(), value]));
    return Object.keys(headers).length ? { ...result, auth: { ...result.auth, headers } } : result;
  };
  if (config?.oauthId) return withHeaders(await resolveModelOAuth(model.provider, config.oauthId, signal));
  if (model.provider === "custom" || (!getProvider(model.provider) && config?.custom === true)) {
    return withHeaders({ auth: { apiKey: key || "local" }, env, source: key ? "Saved API key" : "No authentication" });
  }
  const provider = getProvider(model.provider);
  if (!provider?.auth.apiKey) throw new Error("This provider requires OAuth. Use Sign in & Save in Model settings.");
  const result = await provider.auth.apiKey.resolve({
    credential: key || config?.env ? { type: "api_key", key, env: config?.env } : undefined,
    signal,
    ctx: {
      env: async name => env[name] || processEnv[name],
      fileExists: async path => existsSync(path.startsWith("~/") ? join(homedir(), path.slice(2)) : path),
    },
  });
  return result ? withHeaders({ ...result, env: { ...env, ...result.env } }) : undefined;
}

/** Convert only the active legacy connection when the user opens the editor. */
export function createModelSettingsDraft(settings: OhQuantSettings): OhQuantSettings {
  const draft = structuredClone(settings);
  if (draft.provider) return draft;
  const model = resolveConfiguredModel(draft);
  const config: ModelProviderSettings = { model: model.id };
  const catalog = getModels(model.provider).find(candidate => candidate.id === model.id);
  if (model.baseUrl !== catalog?.baseUrl) config.baseUrl = model.baseUrl;
  if (model.api !== catalog?.api) config.api = model.api as ModelProviderSettings["api"];
  if (model.contextWindow !== catalog?.contextWindow) config.models = { [model.id]: { contextWindow: model.contextWindow } };
  const key = resolveApiKey(draft.env);
  if (key) config.apiKey = key;
  draft.provider = model.provider;
  draft.model = model.id;
  draft.providers = { ...draft.providers, [model.provider]: config };
  draft.thinkingLevel = configuredThinking(draft);
  return draft;
}

export function resolveApiKey(env: Record<string, string>): string | undefined {
  return readWhyjEnvValue(env, "apiKey") || readWhyjEnvValue(env, "authToken")
    || readWhyjEnvValue(process.env, "apiKey") || readWhyjEnvValue(process.env, "authToken");
}

export function resolveModelId(model: string, env: Record<string, string>): string {
  const envKey = `WHYJ_DEFAULT_${model.toUpperCase()}_MODEL`;
  return env[envKey] || process.env[envKey] || inferModelId(model);
}

function getUrlTail(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    return (segments.at(-1) || "").toLowerCase();
  } catch {
    return "";
  }
}

function isAnthropicStyleEndpoint(baseUrl: string): boolean {
  const tail = getUrlTail(baseUrl);
  return tail === "anthropic" || baseUrl.includes("anthropic.com");
}

export function inferModelId(model: string): string {
  switch (model) {
    case "sonnet": return "deepseek-v4-pro";
    case "opus": return "deepseek-v4-pro";
    case "haiku": return "deepseek-v4-flash";
    case "deepseek": return "deepseek-v4-pro";
    case "gpt-5.5": return "openai/gpt-5.5";
    default: return model;
  }
}

export function inferProvider(modelId: string, env: Record<string, string>): string {
  const baseUrl = stripTerminalControlCodes(env.WHYJ_QUANT_BASE_URL || process.env.WHYJ_QUANT_BASE_URL || "");
  if (isAnthropicStyleEndpoint(baseUrl)) return "anthropic";
  if (baseUrl.includes("open.bigmodel.cn") || baseUrl.includes("api.z.ai")) return "zai";
  if (baseUrl.includes("api.minimaxi.com") || baseUrl.includes("minimaxi.com")) return "minimax";
  if (modelId.startsWith("openai/")) return "openrouter";
  if (modelId.startsWith("deepseek-")) return "deepseek";
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gpt-") || modelId.startsWith("o")) return "openai";
  if (modelId.startsWith("gemini-")) return "google";
  if (modelId.startsWith("mistral-")) return "mistral";
  return "deepseek";
}

export function resolveModel(provider: string, id: string, env: Record<string, string>): Model<Api> {
  const baseUrl =
    stripTerminalControlCodes(env.WHYJ_QUANT_BASE_URL || process.env.WHYJ_QUANT_BASE_URL || "");
  const resolvedProvider = isAnthropicStyleEndpoint(baseUrl)
    ? "anthropic"
    : provider;

  const models = getModels(resolvedProvider);
  const model = models.find((candidate) => candidate.id === id);
  const resolved = model ? { ...model } : (() => {
    const prefix = models.find((candidate) => id.startsWith(candidate.id));
    if (prefix) return { ...prefix };
    if (resolvedProvider === "anthropic") {
      const anthropicModel = buildAnthropicFallbackModel(id, baseUrl || undefined);
      if (anthropicModel) return anthropicModel;
    }
    const genericModel = buildGenericFallbackModel(resolvedProvider, id, baseUrl || undefined);
    if (genericModel) return genericModel;
    throw new Error(`pi-ai model not found: ${resolvedProvider}/${id}`);
  })();
  if (baseUrl) {
    resolved.baseUrl = baseUrl;
    if (getUrlTail(baseUrl) === "v1") resolved.api = "openai-completions";
  }
  resolved.id = id;
  resolved.contextWindow = resolveContextWindow(env, resolved.contextWindow);
  return resolved;
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveContextWindow(env: Record<string, string>, fallback: number): number {
  const configured = readPositiveInteger(
    readWhyjEnvValue(env, "contextWindow")
      ?? readWhyjEnvValue(process.env, "contextWindow"),
  );
  return configured ?? fallback;
}

export function resolveCompactTriggerTokens(env: Record<string, string>, contextWindow: number): number {
  const configured = readPositiveInteger(
    readWhyjEnvValue(env, "compactTriggerTokens")
      ?? readWhyjEnvValue(process.env, "compactTriggerTokens"),
  );
  const fallback = Math.max(1, contextWindow - 16_384);
  return Math.min(configured ?? fallback, contextWindow);
}

function buildGenericFallbackModel(provider: string, id: string, baseUrl?: string): Model<"openai-completions"> | undefined {
  if (!baseUrl) return undefined;
  if (provider !== "zai" && provider !== "minimax" && provider !== "minimax-cn") return undefined;
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: provider as "zai" | "minimax" | "minimax-cn",
    baseUrl,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 128000,
  };
}

function buildAnthropicFallbackModel(id: string, baseUrl?: string): Model<Api> | undefined {
  const anthropicBaseUrl = baseUrl || "https://api.anthropic.com";
  if (id.startsWith("deepseek-")) {
    const deepseekModels = getModels("deepseek");
    const template = deepseekModels.find((candidate) => id.startsWith(candidate.id));
    if (!template) return undefined;
    return {
      ...template,
      provider: "anthropic",
      api: "anthropic-messages",
      baseUrl: anthropicBaseUrl,
    };
  }

  const genericAnthropicModel: Model<"anthropic-messages"> = {
    id,
    name: id,
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: anthropicBaseUrl,
    reasoning: true,
    thinkingLevelMap: { minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 128000,
  };

  return genericAnthropicModel;
}
