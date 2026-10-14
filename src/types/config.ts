import type { MarketColorScheme } from "./theme-colors.ts";

export type Market = "A" | "HK" | "US" | "Fund" | "Crypto";
export type DataSource = "akshare" | "tushare" | "llmquant-data" | "financial-datasets";
export type HudMode = "full" | "context" | "off";

export const DEFAULT_TERMINAL_OPERATION_KEYBINDINGS = {
  interruptResearch: ["ctrl+g"], retryFailedQuotes: ["ctrl+r"],
};

export function normalizeHudMode(value: unknown): HudMode {
  return value === "context" || value === "off" ? value : "full";
}

export interface UserPreferences {
  /** Missing legacy values normalize to red-up. Applies to all displayed markets. */
  marketColorScheme?: MarketColorScheme;
  hudMode?: HudMode;
  defaultMarket: Market;
  defaultBenchmark: string;
  defaultCash: number;
  defaultFast: number;
  defaultSlow: number;
  currentPortfolioFile: string;
  source: DataSource;
}

export interface SkillIntegrationSettings {
  /** Load user-level skills from Codex, Claude, Agents, and pi directories. */
  external: boolean;
  /** @deprecated Legacy input migrated to `external`. */
  codex?: boolean;
  /** @deprecated Legacy input migrated to `external`. */
  claude?: boolean;
}

export type ArtifactGenerationMode = "manual" | "auto";

export interface ArtifactGenerationSettings {
  /** Generate and open a report after a completed quant-analysis turn. */
  auto: boolean;
  /** @deprecated v2 input migrated to `auto`. */
  mode?: ArtifactGenerationMode;
}

export interface OhQuantSettings {
  /** Disk version carried by an editing draft; excluded from the persisted payload. */
  revision?: string;
  version: number;
  /** Claude Code-style env vars (API keys, base URLs, etc.) */
  env: Record<string, string>;
  /** Pi provider ID. Absent only for legacy configuration. */
  provider?: string;
  /** Provider-scoped connections; switching models never reuses another provider's key. */
  providers?: Record<string, ModelProviderSettings>;
  /** Actual model ID; legacy configuration also accepts role aliases. */
  model: string;
  /** Thinking level constrained by the selected Pi model, including off and max. */
  thinkingLevel: string;
  /** Whether the right-side overview/portfolio panel is visible. */
  showPortfolioPanel: boolean;
  /** Artifact report generation policy. Auto mode also opens the generated report. */
  artifactGeneration: ArtifactGenerationSettings;
  /** Optional user-level skill integrations. Project quant skills are always loaded. */
  skillIntegrations: SkillIntegrationSettings;
  /** Tool allow/deny lists */
  permissions: { allow?: string[]; deny?: string[] };
  /** Explicitly disabled compiled extension IDs; absent means all catalog entries enabled. */
  disabledExtensions?: string[];
  /** Terminal operation bindings; empty arrays disable an action. Changes apply at next launch. */
  keybindings?: { interruptResearch?: string[]; retryFailedQuotes?: string[] };
  /** User business preferences */
  preferences: UserPreferences;
}

export type ModelProtocol = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai"
  | "azure-openai-responses" | "bedrock-converse-stream" | "google-vertex" | "mistral-conversations" | "openai-codex-responses" | "pi-messages";

export interface ModelProviderSettings {
  /** A separate credential record; settings never contain OAuth access/refresh tokens. */
  oauthId?: string;
  name?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  compat?: Record<string, unknown>;
  /** Explicitly declares a named endpoint outside the Pi built-in provider catalog. */
  custom?: boolean;
  apiKey?: string;
  /** Provider environment, for example AWS_PROFILE or CLOUDFLARE_ACCOUNT_ID. */
  env?: Record<string, string>;
  baseUrl?: string;
  api?: ModelProtocol;
  model?: string;
  /** Capability overrides belong to an exact model ID, not the whole provider. */
  models?: Record<string, ModelCapabilitySettings>;
}

export interface ModelCapabilitySettings {
  baseUrl?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  samplingParams?: Record<string, unknown>;
  thinkingLevelMap?: Partial<Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>>;
  /** Model protocol takes precedence over the provider default. */
  api?: ModelProtocol;
  /** A full imported model definition replaces catalog metadata rather than merging it. */
  replaceCatalog?: boolean;
  name?: string;
  input?: ("text" | "image")[];
  cost?: ModelCostSettings;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export interface ModelCostSettings {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tiers?: Array<{ inputTokensAbove: number; input: number; output: number; cacheRead: number; cacheWrite: number }>;
}

export const DEFAULT_SETTINGS: OhQuantSettings = {
  version: 3,
  env: {},
  model: "sonnet",
  thinkingLevel: "high",
  showPortfolioPanel: true,
  artifactGeneration: {
    auto: false,
  },
  skillIntegrations: {
    external: false,
  },
  permissions: {},
  preferences: {
    marketColorScheme: "red-up",
    hudMode: "full",
    defaultMarket: "A",
    defaultBenchmark: "000300.SH",
    defaultCash: 100_000,
    defaultFast: 20,
    defaultSlow: 60,
    currentPortfolioFile: "holdings.json",
    source: "llmquant-data",
  },
};
