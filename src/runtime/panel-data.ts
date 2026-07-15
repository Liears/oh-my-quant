import {
  hasWhyjEnvValue,
  listLocalPortfolios,
  listStoredSessions,
  loadPanelPortfolio,
  loadSettings,
  saveSettings,
  stripTerminalControlCodes,
  syncPanelPortfolioFromLocalPortfolio,
  type ArtifactMeta,
  type LocalPortfolioSummary,
  type PanelPortfolioFile,
  type StoredSessionContextUsage,
  type StoredSessionSummary,
  type SyncedPanelPortfolio,
  type WhyjEnvAliasKey,
} from "../storage/index.ts";
import { listRestorableArtifactReports } from "./artifact-reports.ts";
import type { OhQuantSettings } from "../types/config.ts";

export type {
  ArtifactMeta,
  LocalPortfolioSummary,
  StoredSessionContextUsage,
  StoredSessionSummary,
  WhyjEnvAliasKey,
};

export type PanelSessionScope = "cwd" | "all";
export type PanelSessionSort = "updated" | "created";

export interface PanelDataService {
  cwd(): string;
  loadSettings(): OhQuantSettings;
  saveSettings(settings: OhQuantSettings): void;
  listStoredSessions(options: {
    cwd: string;
    limit: number;
    scope: PanelSessionScope;
    sort: PanelSessionSort;
  }): StoredSessionSummary[];
  listLocalPortfolios(): LocalPortfolioSummary[];
  listArtifacts(): ArtifactMeta[];
  loadPanelPortfolio(): PanelPortfolioFile;
  syncPanelPortfolioFromLocalPortfolio(fileName: string): SyncedPanelPortfolio | null;
  hasWhyjEnvValue(env: Record<string, string | undefined>, key: WhyjEnvAliasKey): boolean;
  stripTerminalControlCodes(value: string): string;
}

export function createStoragePanelDataService(): PanelDataService {
  return {
    cwd: () => process.cwd(),
    loadSettings,
    saveSettings,
    listStoredSessions,
    listLocalPortfolios,
    listArtifacts: listRestorableArtifactReports,
    loadPanelPortfolio,
    syncPanelPortfolioFromLocalPortfolio,
    hasWhyjEnvValue,
    stripTerminalControlCodes,
  };
}
