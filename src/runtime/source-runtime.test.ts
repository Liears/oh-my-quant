import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveBars, saveSettings } from "../storage/index.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";
import { createStorageSourceProviderOptions, createStorageSourceProviderOptionsAsync, fetchBars, fetchLiveBars } from "./source-runtime.ts";

const OHQ = join(process.cwd(), ".ohquant-test-source-runtime");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

describe("storage source runtime", () => {
  it("uses an explicitly selected offline cache without parsing broken provider settings", async () => {
    const bar = { date: "2025-01-06", open: 10, high: 10, low: 10, close: 10, volume: 100, amount: null };
    await saveBars("AAPL", "financial-datasets", [bar], bar.date, bar.date);
    writeFileSync(join(OHQ, "settings.json"), "{malformed provider config");
    const result = await fetchBars("AAPL", "US", bar.date, bar.date, "financial-datasets", {
      providers: { fallbackOrder: { US: ["financial-datasets"] },
        adapters: { "financial-datasets": { fetchBars: async () => [] } } },
    });
    expect(result).toMatchObject({ source: "financial-datasets", origin: "stale-cache", bars: [bar], dataset: { symbol: "AAPL" } });
    expect(result.attempts).toEqual([{ source: "financial-datasets", status: "empty" }]);
  });

  it("passes settings-backed provider credentials into source adapters", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_TUSHARE_TOKEN: "test-tushare-token",
        WHYJ_QUANT_LLMQUANT_API_KEY: "test-llmquant-key",
        WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "test-financial-key",
      },
    });

    const providers = createStorageSourceProviderOptions();
    expect(providers.tushare?.token).toBe("test-tushare-token");
    expect(providers.llmquant?.apiKey).toBe("test-llmquant-key");
    expect(providers.financialDatasets?.apiKey).toBe("test-financial-key");
  });

  it("reads source preference and credentials through cancellable async settings snapshots", async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      preferences: { ...DEFAULT_SETTINGS.preferences, source: "tushare" },
      env: { WHYJ_QUANT_TUSHARE_TOKEN: "async-test-token" },
    });
    const tushare = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({
      code: 0, data: { fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"],
        items: [["000001.SZ", "20250924", 10, 10, 10, 10, 100, 1000]] },
    })) as unknown as typeof fetch);
    try {
      const result = await fetchBars("000001.SZ", "A", "2025-09-24", "2025-09-24", "auto", {
        providers: { fallbackOrder: { A: ["tushare"] } },
      });
      expect(result).toMatchObject({ source: "tushare", origin: "provider", bars: [{ date: "2025-09-24", close: 10 }] });
      const request = JSON.parse(String(tushare.mock.calls[0]?.[1]?.body)) as { token: string };
      expect(request.token).toBe("async-test-token");
    } finally { tushare.mockRestore(); }

    const controller = new AbortController();
    controller.abort(new Error("settings cancelled"));
    await expect(createStorageSourceProviderOptionsAsync(controller.signal)).rejects.toThrow("settings cancelled");
  });

  it("keeps the runtime deadline when an optional provider budget is undefined or longer", async () => {
    const timers = spyOn(globalThis, "setTimeout");
    const deps = { loadCache: async () => ({ bars: [], fresh: false }), saveBars: async () => {},
      getPreferredSource: () => "akshare" as const };
    const providers = { budgetMs: undefined, adapters: {
      akshare: { fetchBars: async () => [] }, tushare: { fetchBars: async () => [] },
    } };
    try {
      await fetchBars("000001.SZ", "A", undefined, undefined, "auto", { deps, providers });
      expect(timers.mock.calls.some(call => call[1] === 60_000)).toBe(true);
      timers.mockClear();
      await fetchLiveBars("000001.SZ", "A", undefined, undefined, { deps, providers });
      expect(timers.mock.calls.some(call => call[1] === 60_000)).toBe(true);
      timers.mockClear();
      await fetchBars("000001.SZ", "A", undefined, undefined, "auto", { deps, providers: { ...providers, budgetMs: 25 } });
      expect(timers.mock.calls.some(call => call[1] === 25)).toBe(true);
      timers.mockClear();
      await fetchBars("000001.SZ", "A", undefined, undefined, "auto", { deps, providers: { ...providers, budgetMs: 120_000 } });
      expect(timers.mock.calls.some(call => call[1] === 60_000)).toBe(true);
      await expect(fetchBars("000001.SZ", "A", undefined, undefined, "auto", {
        deps, providers: { ...providers, budgetMs: 2_147_483_648 },
      })).rejects.toThrow("Provider budget");
    } finally { timers.mockRestore(); }
  });
});
