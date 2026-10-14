import { expect, it, mock } from "bun:test";
import { probeDataConnection } from "../data/data-readiness.ts";
import { probeToolEndpoint } from "../data/tool-probe.ts";
import { DataSettingsDraft } from "../data/data-settings.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";

const javascript = { status: "blocked", winerror: 4551 } as const;
const dependency = { status: "ready", python: "fixture", akshare: "fixture", javascript } as const;
const window = { start: "2025-01-06", end: "2025-01-06" };

it("retains US/HK native-block evidence but lets the native-free daily adapter prove actual data readiness", async () => {
  for (const [market, symbol] of [["US", "AAPL"], ["HK", "00700.HK"]] as const) {
    const nativeChecks: Array<boolean | undefined> = [];
    const provider = mock(async () => ({ bars: [{ date: window.start, open: 1, high: 1, low: 1, close: 1, volume: 1, amount: null }],
      endpoint: market === "US" ? "sina_us_daily_native_free" : "sina_hk_daily_native_free", adjustment: "unadjusted" as const }));
    const result = await probeDataConnection(DEFAULT_SETTINGS, { source: "akshare", market, symbol, ...window }, {
      checkDependency: async options => { nativeChecks.push(options.javascript); return dependency; },
      adapters: { akshare: { fetchBars: provider } },
    });
    expect(result).toMatchObject({ status: "ready", rowCount: 1, dependency, credentialSource: "not-required" });
    expect(result.providerEndpoint).toBe(market === "US" ? "sina_us_daily_native_free" : "sina_hk_daily_native_free");
    expect(nativeChecks).toEqual([true]);
    expect(provider).toHaveBeenCalledTimes(1);
  }
});

it("allows the fund literal fallback to prove ready data while retaining the blocked native dependency evidence", async () => {
  const provider = mock(async () => ({ bars: [{ date: window.start, open: 1, high: 1, low: 1, close: 1, volume: 0, amount: null }],
    endpoint: "eastmoney_fund_net_worth", adjustment: "unit-nav" as const }));
  const result = await probeDataConnection(DEFAULT_SETTINGS, { source: "akshare", market: "Fund", symbol: "270042.OF", ...window }, {
    checkDependency: async () => dependency, adapters: { akshare: { fetchBars: provider } },
  });
  expect(result).toMatchObject({ status: "ready", rowCount: 1, capability: "unit-nav", dependency });
  expect(result.providerEndpoint).toBe("eastmoney_fund_net_worth");
  expect(provider).toHaveBeenCalledTimes(1);
});

it("does not block A-share non-JavaScript routes or misclassify other native runtime failures", async () => {
  let native: boolean | undefined;
  const a = await probeDataConnection(DEFAULT_SETTINGS, { source: "akshare", market: "A", symbol: "000001.SZ", ...window }, {
    checkDependency: async options => { native = options.javascript; return dependency; },
    adapters: { akshare: { fetchBars: async () => [{ date: window.start, open: 10, high: 10, low: 10, close: 10, volume: 0, amount: null }] } },
  });
  expect(a.status).toBe("ready");
  expect(native).toBe(false);
  for (const status of ["missing-package", "unavailable"] as const) {
    const provider = mock(async () => []);
    const result = await probeDataConnection(DEFAULT_SETTINGS, { source: "akshare", market: "US", symbol: "AAPL", ...window }, {
      checkDependency: async () => ({ ...dependency, javascript: { status } }), adapters: { akshare: { fetchBars: provider } },
    });
    expect(result.status).toBe(status === "missing-package" ? "missing-package" : "unavailable");
    expect(provider).not.toHaveBeenCalled();
    expect(result.action).not.toContain("Windows");
  }
});

it("propagates scoped native failures through endpoint checks and prevents verified settings save", async () => {
  const calls: Array<boolean | undefined> = [];
  const fundRows = mock(async () => ({ endpoint: "fund_open_fund_info_em" as const, params: {}, rows: [], rowCount: 0, fetchedAt: "fixture" }));
  const result = await probeToolEndpoint(DEFAULT_SETTINGS, { tool: "akshare_fund_nav", provider: "akshare",
    endpoint: "fund_open_fund_info_em", market: "Fund", params: { symbol: "270042", indicator: "单位净值走势" } }, {
    checkDependency: async options => { calls.push(options.javascript); return dependency; }, adapters: { fundRows },
  });
  expect(result).toMatchObject({ status: "blocked-runtime", dependency });
  expect(calls).toEqual([true]);
  expect(fundRows).not.toHaveBeenCalled();
  const draft = new DataSettingsDraft(DEFAULT_SETTINGS, { probe: async (_settings, request, options) =>
    probeDataConnection(DEFAULT_SETTINGS, request, { ...options, checkDependency: async () => dependency, adapters: { akshare: { fetchBars: async () => [] } } }) });
  draft.setMarket("US"); draft.setSource("akshare");
  await draft.verify();
  expect(draft.readiness?.status).toBe("empty");
  expect(draft.readiness?.dependency).toEqual(dependency);
  expect(draft.canSave).toBe(false);
  expect(() => draft.prepareSave()).toThrow();
  draft.dispose();
});
