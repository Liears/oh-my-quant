import { describe, expect, it } from "bun:test";
import {
  activePanelPortfolioName,
  buildLocalStorageState,
  marketRefreshLoadingPanel,
  marketUnavailablePanel,
} from "./panel-service.ts";

describe("runtime panel service", () => {
  it("derives active portfolio names from groups, symbols, or fallback files", () => {
    expect(activePanelPortfolioName({ symbols: [], groups: [{ name: "Core" }] }, "holdings.json")).toBe("Core");
    expect(activePanelPortfolioName({ symbols: [], groups: [{ name: "A" }, { name: "B" }] }, "holdings.json")).toBe("2 groups");
    expect(activePanelPortfolioName({ symbols: [{ code: "510300.SH" }], groups: [] }, "holdings.json")).toBe("1 symbols");
    expect(activePanelPortfolioName({ symbols: [], groups: [] }, "holdings.json")).toBe("holdings.json");
  });

  it("builds local state from settings and the loaded panel portfolio", () => {
    expect(buildLocalStorageState({
      preferences: { currentPortfolioFile: "alpha.json", source: "akshare" },
      showPortfolioPanel: false,
    }, {
      symbols: [],
      groups: [{ name: "Alpha" }],
    })).toEqual({
      activePortfolio: "Alpha",
      source: "akshare",
      showPortfolioPanel: false,
    });

    expect(buildLocalStorageState({ preferences: {} }, { symbols: [], groups: [] })).toEqual({
      activePortfolio: "holdings.json",
      source: "llmquant-data",
      showPortfolioPanel: true,
    });
  });

  it("provides stable loading and unavailable market panels", () => {
    expect(marketRefreshLoadingPanel()).toEqual([
      { kind: "keyvalue", title: "Market Refresh", rows: [{ label: "status", value: "fetching" }] },
    ]);
    expect(marketUnavailablePanel()).toEqual([
      { kind: "keyvalue", title: "Market", rows: [{ label: "data", value: "unavailable" }] },
    ]);
  });
});
