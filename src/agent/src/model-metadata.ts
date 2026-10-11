import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelCapabilitySettings, ModelCostSettings } from "../../types/config.ts";

/** Validate configuration at the boundary; Pi still owns protocol behavior and cost calculation. */
export function configObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid model configuration object.");
  return value as Record<string, unknown>;
}

type Validator = (value: unknown) => boolean;
const string: Validator = value => typeof value === "string";
const boolean: Validator = value => typeof value === "boolean";
const number: Validator = value => typeof value === "number" && Number.isFinite(value);
const strings: Validator = value => Array.isArray(value) && value.every(string);
const oneOf = (...values: string[]): Validator => value => typeof value === "string" && values.includes(value);
const record = (check: Validator): Validator => value => value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(check);
const shape = (checks: Record<string, Validator>): Validator => value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, item]) => Object.hasOwn(checks, key) && checks[key]!(item));
};
const nullableString: Validator = value => value === null || string(value);
const percentile = shape({ p50: number, p75: number, p90: number, p99: number });
const templateValue: Validator = value => value === null || string(value) || number(value) || boolean(value)
  || (shape({ $var: oneOf("thinking.enabled", "thinking.effort", "thinking.budget"), omitWhenOff: boolean })(value)
    && Object.hasOwn(value as object, "$var"));
const routing = shape({
  allow_fallbacks: boolean, require_parameters: boolean, data_collection: oneOf("allow", "deny"), zdr: boolean, enforce_distillable_text: boolean,
  order: strings, only: strings, ignore: strings, quantizations: strings,
  sort: value => string(value) || shape({ by: string, partition: nullableString })(value),
  max_price: shape(Object.fromEntries(["prompt", "completion", "image", "audio", "request"].map(key => [key, (value: unknown) => number(value) || string(value)]))),
  preferred_min_throughput: value => number(value) || percentile(value), preferred_max_latency: value => number(value) || percentile(value),
});
const compatShape = shape({
  ...Object.fromEntries([
    "supportsStore", "supportsDeveloperRole", "supportsReasoningEffort", "supportsUsageInStreaming", "supportsFinishReason",
    "requiresToolResultName", "requiresAssistantAfterToolResult", "requiresThinkingAsText", "requiresReasoningContentOnAssistantMessages",
    "zaiToolStream", "supportsThinkingTokenBudget", "supportsOpenAIGrammarTools", "supportsStrictMode", "sendSessionAffinityHeaders",
    "supportsLongCacheRetention", "supportsAdditionalTools", "supportsToolSearch", "supportsExplicitPromptCacheMode", "supportsMaxOutputTokens",
    "supportsEagerToolInputStreaming", "supportsCacheControlOnTools", "supportsTemperature", "forceAdaptiveThinking", "allowEmptySignature",
    "supportsStrictTools", "supportsMidConvoEffort", "supportsMidConvoSystemMessages",
    "supportsMidConvoToolAdditions", "supportsMidConvoToolChanges",
  ].map(key => [key, boolean])),
  maxTokensField: oneOf("max_completion_tokens", "max_tokens"),
  thinkingFormat: oneOf("openai", "openrouter", "deepseek", "together", "baseten", "zai", "qwen", "qwen-chat-template", "chat-template", "string-thinking", "ant-ling"),
  chatTemplateKwargs: record(templateValue), chatTemplateArgs: record(templateValue),
  openRouterRouting: routing, vercelGatewayRouting: shape({ only: strings, order: strings }),
  thinkingTokenBudgetField: oneOf("thinking_token_budget", "thinking_budget", "thinking_budget_tokens"),
  cacheControlFormat: oneOf("anthropic"), sessionAffinityFormat: oneOf("openai", "openai-nosession", "openrouter"),
  vllmPriority: number,
  allowedFallbackModels: value => Array.isArray(value) && value.every(item => {
    if (!shape({ provider: string, model: string, cost: () => true })(item)) return false;
    const entry = item as Record<string, unknown>;
    if (![entry.provider, entry.model].every(value => typeof value === "string" && value.trim() === value && value.length > 0 && !/[\x00-\x1f\x7f]/.test(value))) return false;
    try { validateModelCost(entry.cost); return true; } catch { return false; }
  }),
});

export function validateModelCompat(value: unknown): Record<string, unknown> {
  if (!compatShape(value)) throw new Error("Invalid or unsupported model compatibility fields.");
  return structuredClone(configObject(value));
}

/** Pi merges only these nested compatibility objects per key, never concatenating arrays. */
export function mergeModelCompat(...values: Array<Record<string, unknown> | undefined>): Record<string, unknown> | undefined {
  let merged: Record<string, unknown> | undefined;
  for (const value of values) {
    if (!value) continue;
    const next = { ...merged, ...value };
    for (const key of ["openRouterRouting", "vercelGatewayRouting", "chatTemplateKwargs", "chatTemplateArgs"]) {
      if (merged?.[key] || value[key]) next[key] = { ...configObject(merged?.[key] ?? {}), ...configObject(value[key] ?? {}) };
    }
    merged = next;
  }
  return merged ? structuredClone(merged) : undefined;
}

export function validateModelCost(value: unknown): ModelCostSettings {
  const cost = configObject(value), rates = ["input", "output", "cacheRead", "cacheWrite"];
  const validRates = (row: Record<string, unknown>) => rates.every(key => number(row[key]) && (row[key] as number) >= 0);
  if (Object.keys(cost).some(key => ![...rates, "tiers"].includes(key)) || !validRates(cost)) throw new Error("Invalid model pricing metadata.");
  if (cost.tiers !== undefined && (!Array.isArray(cost.tiers) || cost.tiers.some(tier => {
    const row = configObject(tier);
    return Object.keys(row).some(key => ![...rates, "inputTokensAbove"].includes(key)) || !validRates(row)
      || !Number.isSafeInteger(row.inputTokensAbove) || (row.inputTokensAbove as number) < 0;
  }))) throw new Error("Invalid model pricing tiers.");
  return structuredClone(cost) as unknown as ModelCostSettings;
}

export function validateModelHeaders(value: unknown): Record<string, string> {
  const headers = configObject(value);
  if (Object.entries(headers).some(([key, item]) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)
    || typeof item !== "string" || /[\x00-\x1f\x7f]/.test(item))) throw new Error("Invalid model request headers.");
  return structuredClone(headers) as Record<string, string>;
}

export function applyModelMetadata(model: Model<Api>, capabilities: ModelCapabilitySettings, providerCompat?: Record<string, unknown>): void {
  if (capabilities.thinkingLevelMap !== undefined) {
    if (!shape(Object.fromEntries(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(key => [key, nullableString])))(capabilities.thinkingLevelMap)) throw new Error("Invalid thinking level map.");
    model.thinkingLevelMap = { ...model.thinkingLevelMap, ...capabilities.thinkingLevelMap };
  }
  if (capabilities.samplingParams !== undefined) model.samplingParams = { ...model.samplingParams, ...structuredClone(configObject(capabilities.samplingParams)) };
  // Imported headers travel with resolved auth, as in Pi ModelRuntime, not catalog metadata.
  if (capabilities.headers !== undefined) validateModelHeaders(capabilities.headers);
  if (providerCompat !== undefined || capabilities.compat !== undefined) model.compat = mergeModelCompat(
    model.compat as Record<string, unknown> | undefined,
    providerCompat === undefined ? undefined : validateModelCompat(providerCompat),
    capabilities.compat === undefined ? undefined : validateModelCompat(capabilities.compat),
  ) as Model<Api>["compat"];
  if (capabilities.cost !== undefined) model.cost = validateModelCost(capabilities.cost);
}
