import { getModels, getProvider } from "./kernel/llm.ts";
import { resolveConfiguredModel, configuredThinking, modelProtocols } from "./model-config.ts";
import type { ModelCapabilitySettings, ModelProtocol, OhQuantSettings } from "../../types/config.ts";
import { configObject as object, mergeModelCompat, validateModelCompat, validateModelHeaders, validateModelCost } from "./model-metadata.ts";
import { validateModelOAuthCredential } from "../../types/model-auth.ts";

export interface PiConfigInput { models: unknown; auth: unknown; settings: unknown }

function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)
    || ["__proto__", "prototype", "constructor"].includes(value)) throw new Error("Invalid Pi provider/model identifier.");
  return value;
}
function fields(value: Record<string, unknown>, allowed: string[], label: string) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`Unsupported ${label} fields; import stopped without dropping configuration.`);
}

/** Pi 0.85.1 interpolation; command-valued credentials never execute during import. */
export function resolvePiKey(value: unknown, env: Record<string, string | undefined>, allowEmpty = false): string {
  if (typeof value !== "string" || value.startsWith("!")) throw new Error("Command or invalid Pi credentials cannot be imported.");
  const result = value.replace(/\$(\$|!|\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/g, (_match, part: string) => {
    if (part === "$" || part === "!") return part;
    const name = part.startsWith("{") ? part.slice(1, -1) : part;
    if (!env[name]) throw new Error("Pi credential environment reference is unresolved.");
    return env[name]!;
  });
  if ((!result && !allowEmpty) || /[\x00-\x1f\x7f]/.test(result)) throw new Error("Pi credential is empty or contains control characters.");
  return result;
}

export function listPiConnections(input: PiConfigInput) {
  const providers = object(object(input.models).providers ?? {}), auth = object(input.auth), settings = object(input.settings);
  const names = new Set([...Object.keys(providers), ...Object.keys(auth), ...(typeof settings.defaultProvider === "string" ? [settings.defaultProvider] : [])]);
  return [...names].map(identifier).sort().map(provider => {
    const config = Object.hasOwn(providers, provider) ? object(providers[provider]) : {};
    if (config.models !== undefined && !Array.isArray(config.models)) throw new Error("Pi models must be an array.");
    const models = (config.models as unknown[] | undefined ?? []).map(model => identifier(object(model).id));
    const credential = Object.hasOwn(auth, provider) ? object(auth[provider]) : undefined;
    return { provider, models, builtinModels: getModels(provider).length,
      credential: credential?.type === "oauth" ? "Pi OAuth (preview checks link eligibility)" : credential?.type === "api_key" ? "auth.json API key/environment"
        : config.apiKey !== undefined ? "models.json key expression" : "provider environment or unconfigured" };
  });
}

/** Pure selected-connection mapping; the returned draft contains secrets and is never a command DTO. */
export function mapPiConnection(input: PiConfigInput, current: OhQuantSettings, selection: { provider?: string; model?: string }, processEnv: Record<string, string | undefined>) {
  const defaults = object(input.settings), providers = object(object(input.models).providers ?? {}), auth = object(input.auth);
  const providerId = identifier(selection.provider ?? defaults.defaultProvider), modelId = identifier(selection.model ?? defaults.defaultModel);
  const provider = getProvider(providerId), config = Object.hasOwn(providers, providerId) ? object(providers[providerId]) : {};
  const credential = Object.hasOwn(auth, providerId) ? object(auth[providerId]) : undefined;
  const oauthLinked = credential?.type === "oauth";
  if (oauthLinked) {
    if (!provider?.auth.oauth) throw new Error("Selected Pi OAuth credential cannot be linked to this provider.");
    try { validateModelOAuthCredential(credential); }
    catch { throw new Error("Selected Pi OAuth credential is invalid; no settings changed."); }
  } else if (provider && !provider.auth.apiKey) throw new Error("This Pi provider requires OAuth; select its Pi login before importing.");
  fields(config, ["name", "baseUrl", "api", "apiKey", "models", "modelOverrides", "headers", "authHeader", "compat"], "Pi provider");
  if (config.name !== undefined && (typeof config.name !== "string" || !config.name.trim() || /[\x00-\x1f\x7f]/.test(config.name))) throw new Error("Invalid Pi provider name.");
  if (config.authHeader !== undefined && typeof config.authHeader !== "boolean") throw new Error("Invalid Pi authHeader.");
  const entries = config.models === undefined ? [] : config.models;
  if (!Array.isArray(entries)) throw new Error("Pi models must be an array.");
  const modelEntries = entries.map(object), ids = modelEntries.map(entry => identifier(entry.id));
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate Pi model IDs.");
  const definition = modelEntries.find(entry => entry.id === modelId);
  const known = getModels(providerId).find(model => model.id === modelId);
  if (!definition && !known) throw new Error("Selected Pi model is absent from the file and installed catalog.");
  const overrides = object(config.modelOverrides ?? {});
  const override = Object.hasOwn(overrides, modelId) ? object(overrides[modelId]) : {};
  const metadata = ["name", "reasoning", "input", "cost", "contextWindow", "maxTokens", "headers", "compat", "samplingParams", "thinkingLevelMap"];
  if (definition) fields(definition, ["id", "api", "baseUrl", ...metadata], "Pi model");
  fields(override, metadata, "Pi model override");
  const model = { ...definition, ...override };
  const defaultsModel = known ?? getModels(providerId).find(item => item.api === (definition?.api ?? config.api))
    ?? getModels(providerId).find(item => item.api === "openai-completions") ?? getModels(providerId)[0];
  const api = definition ? definition.api ?? config.api ?? defaultsModel?.api : known?.api;
  if (typeof api !== "string" || !modelProtocols(providerId).includes(api as ModelProtocol)) throw new Error("Pi model protocol is not supported by this provider; native transports require their original provider identity.");
  if (config.baseUrl !== undefined && typeof config.baseUrl !== "string") throw new Error("Invalid Pi endpoint.");
  if (definition?.baseUrl !== undefined && typeof definition.baseUrl !== "string") throw new Error("Invalid Pi model endpoint.");
  const targetProvider = providerId;
  const capability: ModelCapabilitySettings = definition
    ? { replaceCatalog: true, name: modelId, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 16384, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } : {};
  capability.api = api as ModelProtocol;
  if (definition?.baseUrl !== undefined) capability.baseUrl = definition.baseUrl as string;
  for (const key of ["name", "reasoning", "input", "contextWindow", "maxTokens"] as const) {
    if (model[key] !== undefined) Object.assign(capability, { [key]: structuredClone(model[key]) });
  }
  if (definition?.cost !== undefined) capability.cost = validateModelCost(definition.cost);
  if (override.cost !== undefined) capability.cost = validateModelCost({ ...(capability.cost ?? known!.cost), ...object(override.cost) });
  for (const field of ["thinkingLevelMap", "samplingParams"] as const) {
    if (definition?.[field] !== undefined || override[field] !== undefined) Object.assign(capability, { [field]: {
      ...(definition?.[field] === undefined ? {} : object(definition[field])), ...(override[field] === undefined ? {} : object(override[field])),
    } });
  }
  const providerCompat = config.compat === undefined ? undefined : validateModelCompat(config.compat);
  capability.compat = mergeModelCompat(definition?.compat === undefined ? undefined : validateModelCompat(definition.compat),
    override.compat === undefined ? undefined : validateModelCompat(override.compat));
  if (credential && !oauthLinked) fields(credential, ["type", "key", "env"], "Pi credential");
  if (credential && !oauthLinked && credential.type !== "api_key") throw new Error("Unsupported Pi credential type.");
  if (credential?.key !== undefined && typeof credential.key !== "string") throw new Error("Invalid Pi API key value.");
  const credentialEnv = object(oauthLinked ? {} : credential?.env ?? {});
  if (Object.values(credentialEnv).some(value => typeof value !== "string")) throw new Error("Invalid Pi credential environment.");
  const env = credentialEnv as Record<string, string>;
  const keyValue = oauthLinked ? config.apiKey : credential?.key ?? config.apiKey;
  const snapshotEnv = { ...processEnv, ...Object.fromEntries(Object.entries(env).filter(([, value]) => value)) };
  const key = keyValue === undefined ? undefined : resolvePiKey(keyValue, snapshotEnv);
  if (!provider && config.authHeader === true && !key) throw new Error("authHeader requires a resolved API key.");
  const snapshotHeaders = (value: unknown) => Object.fromEntries(Object.entries(validateModelHeaders(value)).map(([name, raw]) => [name, resolvePiKey(raw, snapshotEnv, true)]));
  const headers = config.headers === undefined ? undefined : snapshotHeaders(config.headers);
  if (override.headers !== undefined || definition?.headers !== undefined) capability.headers = {
    ...(override.headers === undefined ? {} : snapshotHeaders(override.headers)), ...(definition?.headers === undefined ? {} : snapshotHeaders(definition.headers)),
  };
  const draft = structuredClone(current);
  draft.providers ??= {};
  if (draft.provider) draft.providers[draft.provider] = { ...draft.providers[draft.provider], model: draft.model };
  const previous = draft.providers[targetProvider];
  const retainedModels: Record<string, ModelCapabilitySettings> = { ...(previous?.model ? { [previous.model]: {} } : {}), ...previous?.models };
  const models = Object.fromEntries(Object.entries(retainedModels).map(([id, model]) =>
    [id, { ...model, ...(model.api === undefined && previous?.api ? { api: previous.api } : {}) }]));
  draft.provider = targetProvider; draft.model = modelId;
  draft.providers = { ...draft.providers, [targetProvider]: {
    model: modelId, ...(!provider ? { custom: true } : {}),
    ...(config.name !== undefined ? { name: config.name as string } : {}),
    ...(headers !== undefined ? { headers } : {}), ...(config.authHeader !== undefined ? { authHeader: config.authHeader as boolean } : {}),
    ...(providerCompat !== undefined ? { compat: providerCompat } : {}),
    ...(config.api !== undefined ? { api: config.api as ModelProtocol } : {}),
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl as string } : {}),
    ...(key !== undefined ? { apiKey: key } : oauthLinked && previous?.apiKey ? { apiKey: previous.apiKey } : {}),
    ...(Object.keys(env).length ? { env: { ...env } } : {}), models: { ...models, [modelId]: capability },
  } };
  if (defaults.defaultThinkingLevel !== undefined) {
    if (typeof defaults.defaultThinkingLevel !== "string" || !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(defaults.defaultThinkingLevel)) throw new Error("Invalid Pi thinking level.");
    draft.thinkingLevel = defaults.defaultThinkingLevel;
  }
  const resolved = resolveConfiguredModel(draft);
  draft.thinkingLevel = configuredThinking(draft);
  return { draft, oauthLinked, summary: { sourceProvider: providerId, targetProvider, model: modelId, baseUrl: resolved.baseUrl, api: resolved.api,
    contextWindow: resolved.contextWindow, maxTokens: resolved.maxTokens, reasoning: resolved.reasoning, input: resolved.input,
    thinking: draft.thinkingLevel, credential: oauthLinked ? "Pi OAuth linked (shared auth.json)" : key ? credential?.key !== undefined ? "auth.json key snapshot" : "models.json key snapshot"
      : Object.keys(env).length ? "auth.json environment" : "provider environment or unconfigured",
    metadata: { headerCount: new Set([...Object.keys(headers ?? {}), ...Object.keys(capability.headers ?? {})].map(name => name.toLowerCase())).size,
      compatibilityFields: Object.keys(resolved.compat ?? {}), samplingParameterCount: Object.keys(resolved.samplingParams ?? {}).length,
      pricingTierCount: resolved.cost.tiers?.length ?? 0, modelUrlOverride: capability.baseUrl !== undefined },
    replacesConnection: Object.hasOwn(current.providers ?? {}, targetProvider), previousProvider: current.provider ?? "legacy", previousModel: current.model,
    notes: ["The selected model is imported under its provider ID; other saved models and providers are retained.",
      "This provider's endpoint, default protocol, credentials, headers and compatibility defaults are replaced for its models; model overrides are retained.",
      oauthLinked ? "Pi owns the OAuth token; WhyJ refreshes it in Pi auth.json under the shared file lock. Sign out removes only the local link."
        : "Credential expressions are resolved into this local snapshot; future Pi changes are not automatically synchronized.",
      "Import does not verify the model endpoint. Run /doctor --phase model separately."] } };
}
