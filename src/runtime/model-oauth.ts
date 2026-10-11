import type { ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import type { OhQuantSettings } from "../types/config.ts";
import { ModelOAuthFile, readSettings, resolveOhquantDir, saveSettings } from "../storage/index.ts";
import { loginModelOAuth } from "../agent/src/model-oauth.ts";
import { resolveConfiguredModel } from "../agent/src/model-config.ts";
import { settingsSaveError } from "./errors.ts";
export type { AuthEvent } from "@earendil-works/pi-ai";

export interface ModelOAuthOptions {
  signIn?: typeof signInModelConnection;
  signOut?: typeof signOutModelConnection;
  openUrl?: typeof openModelAuthUrl;
  onSaved?: (settings: OhQuantSettings) => void;
  onChange?: () => void;
}

/** Open only an explicit HTTP(S) authorization link, without passing it to a shell. */
export async function openModelAuthUrl(value: string): Promise<void> {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid authorization URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Invalid authorization URL.");
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url.href] : [url.href];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", () => reject(new Error("Could not open browser. Copy the displayed authorization URL.")));
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

/** Explicit Sign in & Save action. A cancelled/conflicting login never replaces the active connection. */
export async function signInModelConnection(settings: OhQuantSettings, interaction: ProviderAuthInteraction,
  login: typeof loginModelOAuth = loginModelOAuth): Promise<OhQuantSettings> {
  const draft = structuredClone(settings), root = resolve(resolveOhquantDir());
  const model = resolveConfiguredModel(draft);
  if (!draft.provider) throw new Error("Choose a provider before signing in.");
  if (readSettings().revision !== draft.revision) throw new Error("Settings changed. Reopen the model editor before signing in.");
  const file = await login(draft.provider, interaction, root);
  try {
    interaction.signal.throwIfAborted();
    if (resolve(resolveOhquantDir()) !== root) throw new Error("Workspace changed during OAuth sign-in.");
    draft.providers ??= {};
    draft.providers[draft.provider] = { ...draft.providers[draft.provider], model: model.id, oauthId: file.id };
    saveSettings(draft);
    return draft;
  } catch (error) {
    await file.delete();
    if ((error as NodeJS.ErrnoException | null)?.code) throw new Error(settingsSaveError(error));
    throw error;
  }
}

/** Keep the OAuth selection after logout so requests cannot silently fall back to a saved API key. */
export async function signOutModelConnection(settings: OhQuantSettings, signal?: AbortSignal): Promise<void> {
  const provider = settings.provider, id = provider ? settings.providers?.[provider]?.oauthId : undefined;
  if (!provider || !id) throw new Error("No OAuth connection is selected.");
  await new ModelOAuthFile(provider, id).delete(signal);
}
