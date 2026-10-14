import { existsSync, readFileSync, unlinkSync } from "node:fs";
import type { OhQuantSettings } from "../../types/config.ts";
import { DEFAULT_SETTINGS, normalizeHudMode } from "../../types/config.ts";
import { isModelOAuthId } from "../../types/model-auth.ts";
import { normalizeMarketColorScheme } from "../../types/theme-colors.ts";
import { emitFileEvent } from "./fs-events.ts";
import { canonicalizeWhyjEnv } from "./env-keys.ts";
import { ensureDirs, resolveLegacyConfigPath, resolveSettingsPath } from "./dirs.ts";
import { withFileLock } from "./atomic-file.ts";
import { assertStorageRevision, invalidStorageFile, readDurableJson, readDurableJsonAsync, writeDurableJson } from "./durable-json.ts";

/** Diagnostic snapshot without creating directories or committing migrations. */
export function readSettings(): OhQuantSettings {
  const path = resolveSettingsPath();
  const current = readDurableJson(path);
  return { ...parseSettings(current.value, path), revision: current.revision };
}

/** Read-only request snapshot; normalization is in memory and file I/O remains cancellable. */
export async function readSettingsAsync(signal?: AbortSignal): Promise<OhQuantSettings> {
  const path = resolveSettingsPath();
  const current = await readDurableJsonAsync(path, signal);
  return { ...parseSettings(current.value, path), revision: current.revision };
}

export function loadSettings(): OhQuantSettings {
  ensureDirs();
  const sp = resolveSettingsPath();
  const current = readDurableJson(sp);
  const settings = parseSettings(current.value, sp);
  if (current.value && JSON.stringify(current.value) === JSON.stringify(settings)) return { ...settings, revision: current.revision };
  // Migration is a write: acquire the lock and re-read before normalizing.
  return withFileLock(sp, () => {
    const latest = readDurableJson(sp);
    const normalized = parseSettings(latest.value, sp);
    const revision = latest.value && JSON.stringify(latest.value) === JSON.stringify(normalized)
      ? latest.revision : writeDurableJson(sp, normalized);
    return { ...normalized, revision };
  });
}

export function saveSettings(s: OhQuantSettings): void {
  ensureDirs();
  const sp = resolveSettingsPath();
  withFileLock(sp, () => {
    const current = readDurableJson(sp);
    parseSettings(current.value, sp);
    assertStorageRevision(sp, s.revision, current.revision);
    s.revision = writeDurableJson(sp, parseSettings(s, sp));
  });
}

function parseSettings(raw: Partial<OhQuantSettings> | null, path: string): OhQuantSettings {
  try {
    if (raw) {
      for (const value of [raw.env, raw.providers, raw.preferences, raw.permissions, raw.skillIntegrations, raw.artifactGeneration]) {
        if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw invalidStorageFile(path);
      }
      for (const value of [raw.provider, raw.model, raw.thinkingLevel]) {
        if (value !== undefined && typeof value !== "string") throw invalidStorageFile(path);
      }
      if (Object.values(raw.env ?? {}).some(value => typeof value !== "string")) throw invalidStorageFile(path);
      if (raw.disabledExtensions !== undefined && (!Array.isArray(raw.disabledExtensions)
        || raw.disabledExtensions.some(id => typeof id !== "string" || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(id)))) throw invalidStorageFile(path);
      for (const provider of Object.values(raw.providers ?? {})) {
        if (!provider || typeof provider !== "object" || Array.isArray(provider)) throw invalidStorageFile(path);
        if (provider.oauthId !== undefined && !isModelOAuthId(provider.oauthId)) throw invalidStorageFile(path);
        for (const value of [provider.apiKey, provider.baseUrl, provider.api, provider.model]) {
          if (value !== undefined && typeof value !== "string") throw invalidStorageFile(path);
        }
        if (provider.env !== undefined && (!provider.env || typeof provider.env !== "object" || Array.isArray(provider.env)
          || Object.values(provider.env).some(value => typeof value !== "string"))) throw invalidStorageFile(path);
      }
    }
    return normalizeSettings(raw ?? DEFAULT_SETTINGS);
  }
  catch { throw invalidStorageFile(path); }
}

export function migrateOldConfig(): void {
  const old = resolveLegacyConfigPath();
  if (existsSync(old)) {
    try {
      const oldText = readFileSync(old, "utf-8");
      emitFileEvent({ operation: "READ", path: old, bytes: oldText.length, detail: "legacy config" });
      const oldData = JSON.parse(oldText);
      const settings = loadSettings();
      if (oldData.preferences) settings.preferences = { ...settings.preferences, ...oldData.preferences };
      saveSettings(settings);
      try {
        unlinkSync(old);
        emitFileEvent({ operation: "DELETE", path: old, detail: "legacy config migrated" });
      } catch { /* ok */ }
    } catch { /* skip broken files */ }
  }
}

const MODEL_ALIAS_MAPPINGS = [
  { alias: "sonnet", envKey: "WHYJ_DEFAULT_SONNET_MODEL" },
  { alias: "opus", envKey: "WHYJ_DEFAULT_OPUS_MODEL" },
  { alias: "haiku", envKey: "WHYJ_DEFAULT_HAIKU_MODEL" },
] as const;

export function normalizeModelSelection(model: string | undefined, env: Record<string, string>): string {
  const requested = model?.trim() || DEFAULT_SETTINGS.model;
  const configured = MODEL_ALIAS_MAPPINGS
    .map(({ alias, envKey }) => ({ alias, modelId: env[envKey]?.trim() || "" }))
    .filter(({ modelId }) => modelId.length > 0);
  if (configured.length === 0) return requested;
  if (configured.some(({ alias, modelId }) => requested === alias || requested === modelId)) return requested;
  return configured[0]!.alias;
}

function normalizeSettings(raw: Partial<OhQuantSettings>): OhQuantSettings {
  const env = { ...DEFAULT_SETTINGS.env, ...canonicalizeWhyjEnv(raw.env ?? {}) };
  return {
    version: DEFAULT_SETTINGS.version,
    env,
    ...(raw.provider ? { provider: raw.provider.trim() } : {}),
    ...(raw.providers ? { providers: structuredClone(raw.providers) } : {}),
    model: raw.provider ? raw.model?.trim() || DEFAULT_SETTINGS.model : normalizeModelSelection(raw.model, env),
    thinkingLevel: normalizeThinkingLevel(raw.thinkingLevel),
    showPortfolioPanel: raw.showPortfolioPanel ?? DEFAULT_SETTINGS.showPortfolioPanel,
    artifactGeneration: normalizeArtifactGeneration(raw.artifactGeneration),
    skillIntegrations: normalizeSkillIntegrations(raw.skillIntegrations),
    permissions: { ...DEFAULT_SETTINGS.permissions, ...(raw.permissions ?? {}) },
    ...(raw.disabledExtensions ? { disabledExtensions: [...new Set(raw.disabledExtensions)].sort() } : {}),
    preferences: normalizePreferences(raw.preferences),
  };
}

function normalizeArtifactGeneration(
  raw: Partial<OhQuantSettings["artifactGeneration"]> | undefined,
): OhQuantSettings["artifactGeneration"] {
  return {
    auto: raw?.auto ?? raw?.mode === "auto",
  };
}

const VALID_SOURCES = new Set(["akshare", "tushare", "llmquant-data", "financial-datasets"]);
function isValidSource(s: unknown): boolean {
  return typeof s === "string" && VALID_SOURCES.has(s);
}

export function normalizeSkillIntegrations(
  raw: Partial<OhQuantSettings["skillIntegrations"]> | undefined,
): OhQuantSettings["skillIntegrations"] {
  return {
    external: raw?.external ?? Boolean(raw?.codex || raw?.claude),
  };
}

const VALID_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function normalizeThinkingLevel(value: string | undefined): string {
  return value && VALID_THINKING_LEVELS.has(value) ? value : DEFAULT_SETTINGS.thinkingLevel;
}

function normalizePreferences(raw: Partial<OhQuantSettings["preferences"]> | undefined): OhQuantSettings["preferences"] {
  return {
    marketColorScheme: normalizeMarketColorScheme(raw?.marketColorScheme),
    hudMode: normalizeHudMode(raw?.hudMode),
    defaultMarket: raw?.defaultMarket ?? DEFAULT_SETTINGS.preferences.defaultMarket,
    defaultBenchmark: raw?.defaultBenchmark ?? DEFAULT_SETTINGS.preferences.defaultBenchmark,
    defaultCash: raw?.defaultCash ?? DEFAULT_SETTINGS.preferences.defaultCash,
    defaultFast: raw?.defaultFast ?? DEFAULT_SETTINGS.preferences.defaultFast,
    defaultSlow: raw?.defaultSlow ?? DEFAULT_SETTINGS.preferences.defaultSlow,
    currentPortfolioFile: raw?.currentPortfolioFile ?? DEFAULT_SETTINGS.preferences.currentPortfolioFile,
    source: isValidSource(raw?.source) ? raw!.source! : DEFAULT_SETTINGS.preferences.source,
  };
}


