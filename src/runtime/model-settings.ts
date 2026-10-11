import {
  createModelSettingsDraft, resolveConfiguredModel, configuredThinking, configuredThinkingLevels,
  modelProviders, providerModels, modelProtocols, resolveConfiguredAuth, validateModelBaseUrl, MODEL_PROTOCOLS,
  configureProviderCredentials,
} from "../agent/src/model-config.ts";
import type { OhQuantSettings } from "../types/config.ts";
import { ModelOAuthFile, PiOAuthStore } from "../storage/index.ts";

export {
  createModelSettingsDraft, resolveConfiguredModel, configuredThinking, configuredThinkingLevels,
  modelProviders, providerModels, modelProtocols, validateModelBaseUrl, MODEL_PROTOCOLS,
  configureProviderCredentials,
};
export type { AuthPrompt } from "../agent/src/model-config.ts";
export { resolveCompactTriggerTokens } from "../agent/src/model-config.ts";

export function selectModelProvider(settings: OhQuantSettings, provider: string): void {
  settings.providers ??= {};
  if (settings.provider) {
    settings.providers[settings.provider] = { ...settings.providers[settings.provider], model: settings.model };
  }
  settings.provider = provider;
  settings.model = settings.providers[provider]?.model ?? providerModels(provider, settings)[0]?.id ?? "";
  if (settings.model) settings.thinkingLevel = configuredThinking(settings);
}

export async function modelAuthLabel(settings: OhQuantSettings): Promise<string> {
  try {
    const provider = settings.provider, id = provider ? settings.providers?.[provider]?.oauthId : undefined;
    if (provider && id !== undefined) {
      const file = new ModelOAuthFile(provider, id), link = file.readPiLink();
      const credential = link ? await new PiOAuthStore(provider, link).read() : file.read();
      if (!credential) return "OAuth signed out · sign in again";
      const source = link ? "Pi OAuth linked" : "OAuth saved";
      return credential.expires <= Date.now() + 5 * 60000 ? `${source} · refresh required on next request` : `${source} · account not verified`;
    }
    const result = await resolveConfiguredAuth(settings);
    return result ? `Configured · ${result.source ?? "provider credentials"}` : "Not configured · enter API key or use provider environment";
  } catch (error) {
    return error instanceof Error ? error.message : "Check model configuration";
  }
}
