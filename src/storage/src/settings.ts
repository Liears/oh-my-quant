import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import type { OhQuantSettings } from "../../types/config.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { emitFileEvent } from "./fs-events.ts";
import { canonicalizeWhyjEnv } from "./env-keys.ts";
import { ensureDirs, resolveLegacyConfigPath, resolveSettingsPath } from "./dirs.ts";

export function loadSettings(): OhQuantSettings {
  ensureDirs();
  const sp = resolveSettingsPath();
  if (!existsSync(sp)) {
    const text = JSON.stringify(DEFAULT_SETTINGS, null, 2);
    writeFileSync(sp, text, "utf-8");
    emitFileEvent({ operation: "WRITE", path: sp, bytes: text.length, detail: "default settings" });
    return cloneSettings(DEFAULT_SETTINGS);
  }
  try {
    const text = readFileSync(sp, "utf-8");
    emitFileEvent({ operation: "READ", path: sp, bytes: text.length, detail: "settings" });
    const raw = JSON.parse(text);
    const settings = normalizeSettings(raw);
    if (JSON.stringify(raw) !== JSON.stringify(settings)) {
      saveSettings(settings);
    }
    return settings;
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: OhQuantSettings): void {
  ensureDirs();
  const text = JSON.stringify(normalizeSettings(s), null, 2);
  const sp = resolveSettingsPath();
  writeFileSync(sp, text, "utf-8");
  emitFileEvent({ operation: "WRITE", path: sp, bytes: text.length, detail: "settings" });
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

function cloneSettings(settings: OhQuantSettings): OhQuantSettings {
  return JSON.parse(JSON.stringify(settings)) as OhQuantSettings;
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
    model: normalizeModelSelection(raw.model, env),
    thinkingLevel: normalizeThinkingLevel(raw.thinkingLevel),
    showPortfolioPanel: raw.showPortfolioPanel ?? DEFAULT_SETTINGS.showPortfolioPanel,
    artifactGeneration: normalizeArtifactGeneration(raw.artifactGeneration),
    skillIntegrations: normalizeSkillIntegrations(raw.skillIntegrations),
    permissions: { ...DEFAULT_SETTINGS.permissions, ...(raw.permissions ?? {}) },
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

const VALID_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

export function normalizeThinkingLevel(value: string | undefined): string {
  return value && VALID_THINKING_LEVELS.has(value) ? value : DEFAULT_SETTINGS.thinkingLevel;
}

function normalizePreferences(raw: Partial<OhQuantSettings["preferences"]> | undefined): OhQuantSettings["preferences"] {
  return {
    defaultMarket: raw?.defaultMarket ?? DEFAULT_SETTINGS.preferences.defaultMarket,
    defaultBenchmark: raw?.defaultBenchmark ?? DEFAULT_SETTINGS.preferences.defaultBenchmark,
    defaultCash: raw?.defaultCash ?? DEFAULT_SETTINGS.preferences.defaultCash,
    defaultFast: raw?.defaultFast ?? DEFAULT_SETTINGS.preferences.defaultFast,
    defaultSlow: raw?.defaultSlow ?? DEFAULT_SETTINGS.preferences.defaultSlow,
    currentPortfolioFile: raw?.currentPortfolioFile ?? DEFAULT_SETTINGS.preferences.currentPortfolioFile,
    source: isValidSource(raw?.source) ? raw!.source! : DEFAULT_SETTINGS.preferences.source,
  };
}


