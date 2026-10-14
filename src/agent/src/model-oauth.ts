import { createModels, type AuthResult, type CredentialStore, type Provider, type ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { ModelOAuthFile, PiOAuthStore } from "../../storage/index.ts";
import { getProvider } from "./kernel/llm.ts";

// Pi's variable-path OAuth imports cannot resolve beside our bundled dist/index.js.
// Use its supported static loaders so source and built CLI share the same flows.
async function registerOAuthFlows(): Promise<void> {
  const { registerBunOAuthFlows } = await import("@earendil-works/pi-ai/bun-oauth");
  registerBunOAuthFlows();
}

/** Pi owns token refresh and request auth derivation; this adapter binds one local login generation. */
export async function resolveModelOAuth(providerId: string, id: string, signal = new AbortController().signal,
  root?: string, provider: Provider | undefined = getProvider(providerId)): Promise<AuthResult> {
  if (!provider?.auth.oauth || provider.id !== providerId) throw new Error("This provider has no OAuth authentication method.");
  const file = new ModelOAuthFile(providerId, id, root);
  let link: string | undefined;
  try { signal.throwIfAborted(); link = file.readPiLink(); }
  catch {
    if (signal.aborted) throw new Error("OAuth authentication cancelled.");
    throw new Error("OAuth credentials are unavailable or refresh failed. Sign in again; existing credentials were not replaced on failure.");
  }
  const shared = link ? new PiOAuthStore(providerId, link) : undefined;
  const source = shared ?? file;
  const assertProvider = (candidate: string) => { if (candidate !== providerId) throw new Error("OAuth provider mismatch."); };
  const credentials: CredentialStore = {
    async read(candidate, options) { assertProvider(candidate); options?.signal?.throwIfAborted(); return shared ? shared.read(options?.signal) : file.read(); },
    async list(options) { options?.signal?.throwIfAborted(); return (shared ? await shared.read(options?.signal) : file.read()) ? [{ providerId, type: "oauth" }] : []; },
    async modify(candidate, update, options) {
      assertProvider(candidate);
      return source.modify(async current => {
        const next = await update(current);
        if (next && next.type !== "oauth") throw new Error("OAuth credential type changed unexpectedly.");
        return next;
      }, options?.signal);
    },
    async delete(candidate, options) { assertProvider(candidate); await file.delete(options?.signal); },
  };
  const models = createModels({ credentials });
  // OAuth is the explicit selection. A revoked/missing generation must not use ambient API keys.
  models.setProvider({ ...provider, auth: { oauth: provider.auth.oauth } });
  try {
    await registerOAuthFlows();
    signal.throwIfAborted();
    const result = await models.getAuth(providerId, { signal });
    signal.throwIfAborted();
    if (!result) throw new Error("missing credential");
    return result;
  } catch {
    if (signal.aborted) throw new Error("OAuth authentication cancelled.");
    throw new Error("OAuth credentials are unavailable or refresh failed. Sign in again; existing credentials were not replaced on failure.");
  }
}

export async function loginModelOAuth(providerId: string, interaction: ProviderAuthInteraction, root?: string,
  provider: Provider | undefined = getProvider(providerId)): Promise<ModelOAuthFile> {
  if (!provider?.auth.oauth || provider.id !== providerId) throw new Error("This provider has no OAuth sign-in method.");
  try {
    interaction.signal.throwIfAborted();
    await registerOAuthFlows();
    interaction.signal.throwIfAborted();
    const credential = await provider.auth.oauth.login(interaction);
    interaction.signal.throwIfAborted();
    return ModelOAuthFile.create(providerId, credential, root);
  } catch {
    throw new Error(interaction.signal.aborted ? "OAuth sign-in cancelled; no local credentials saved." : "OAuth sign-in failed; no local credentials saved.");
  }
}
