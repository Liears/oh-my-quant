export type Market = "A" | "HK" | "US" | "Fund" | "Crypto";
export type DataSource = "akshare" | "tushare" | "llmquant-data" | "financial-datasets";

export interface UserPreferences {
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
  version: number;
  /** Claude Code-style env vars (API keys, base URLs, etc.) */
  env: Record<string, string>;
  /** Claude model: "sonnet" | "opus" | "haiku" */
  model: string;
  /** Thinking/reasoning level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" */
  thinkingLevel: string;
  /** Whether the right-side overview/portfolio panel is visible. */
  showPortfolioPanel: boolean;
  /** Artifact report generation policy. Auto mode also opens the generated report. */
  artifactGeneration: ArtifactGenerationSettings;
  /** Optional user-level skill integrations. Project quant skills are always loaded. */
  skillIntegrations: SkillIntegrationSettings;
  /** Tool allow/deny lists */
  permissions: { allow?: string[]; deny?: string[] };
  /** User business preferences */
  preferences: UserPreferences;
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
    defaultMarket: "A",
    defaultBenchmark: "000300.SH",
    defaultCash: 100_000,
    defaultFast: 20,
    defaultSlow: 60,
    currentPortfolioFile: "holdings.json",
    source: "llmquant-data",
  },
};
