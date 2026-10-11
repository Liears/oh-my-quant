import type { AppState, PanelSection } from "../tui/src/types.ts";
import { normalizeMarketColorScheme, type MarketColorScheme } from "../types/theme-colors.ts";
import { normalizeHudMode, type HudMode } from "../types/config.ts";

interface RuntimeSettingsLike {
  preferences: {
    currentPortfolioFile?: string;
    source?: string;
    marketColorScheme?: MarketColorScheme;
    hudMode?: HudMode;
  };
  showPortfolioPanel?: boolean;
}

interface PanelPortfolioLike {
  symbols: Array<{ code: string; name?: string }>;
  groups: Array<{ name: string }>;
}

export function activePanelPortfolioName(portfolio: PanelPortfolioLike, fallback: string): string {
  if (portfolio.groups.length === 1 && portfolio.groups[0]?.name) return portfolio.groups[0].name;
  if (portfolio.groups.length > 1) return `${portfolio.groups.length} groups`;
  if (portfolio.symbols.length > 0) return `${portfolio.symbols.length} symbols`;
  return fallback;
}

export function buildLocalStorageState(
  settings: RuntimeSettingsLike,
  portfolio: PanelPortfolioLike,
): Pick<AppState, "activePortfolio" | "source" | "showPortfolioPanel" | "marketColorScheme" | "hudMode"> {
  return {
    activePortfolio: activePanelPortfolioName(portfolio, "No portfolios"),
    source: settings.preferences.source || "llmquant-data",
    showPortfolioPanel: settings.showPortfolioPanel !== false,
    marketColorScheme: normalizeMarketColorScheme(settings.preferences.marketColorScheme),
    hudMode: normalizeHudMode(settings.preferences.hudMode),
  };
}

export function marketRefreshLoadingPanel(): PanelSection[] {
  return [{ kind: "keyvalue", title: "Market Refresh", rows: [{ label: "status", value: "fetching" }] }];
}

export function marketUnavailablePanel(): PanelSection[] {
  return [{ kind: "keyvalue", title: "Market", rows: [{ label: "data", value: "unavailable" }] }];
}

