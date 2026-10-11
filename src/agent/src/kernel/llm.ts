import { hasApi, lazyStream, type Api, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { builtinProviders, getBuiltinModels, getBuiltinProviders, type BuiltinProvider } from "@earendil-works/pi-ai/providers/all";
export { getSupportedThinkingLevels, clampThinkingLevel } from "@earendil-works/pi-ai";
import { streamSimple as anthropicStream } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as completionsStream } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as responsesStream } from "@earendil-works/pi-ai/api/openai-responses";
import { streamSimple as googleStream } from "@earendil-works/pi-ai/api/google-generative-ai";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";

const providers = builtinProviders();
export function getProviders() { return providers; }
export function getProvider(id: string) { return providers.find(provider => provider.id === id); }

/** Model catalogs and protocol implementations are owned by the pinned pi-ai package. */
export function getModels(provider: string): Model<Api>[] {
  return getBuiltinProviders().includes(provider as BuiltinProvider)
    ? getBuiltinModels(provider as BuiltinProvider) : [];
}

/** Dispatch by the configured protocol, including compatible custom provider URLs. */
export function streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
  const transcript = normalizeContext(context);
  const provider = getProvider(model.provider);
  // Pi pins these gateway APIs even when models.dev omits workers-ai
  // models. Keep Pi's endpoint/auth wrapper for those manually entered IDs.
  const gatewayApi = model.provider === "cloudflare-ai-gateway"
    && ["anthropic-messages", "openai-completions", "openai-responses"].includes(model.api);
  if (provider && (gatewayApi || provider.getModels().some(candidate => candidate.api === model.api))) {
    return provider.streamSimple(model, transcript, options);
  }
  if (hasApi(model, "anthropic-messages")) return anthropicStream(model, transcript, options);
  if (hasApi(model, "openai-completions")) return completionsStream(model, transcript, options);
  if (hasApi(model, "openai-responses")) return responsesStream(model, transcript, options);
  if (hasApi(model, "google-generative-ai")) return googleStream(model, transcript, options);
  return lazyStream(model, async () => { throw new Error(`Unsupported model protocol: ${model.api}`); });
}

export function completeSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
  return streamSimple(model, context, options).result();
}
