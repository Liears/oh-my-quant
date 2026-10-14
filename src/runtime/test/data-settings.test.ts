import { expect, it } from "bun:test";
import { setImmediate } from "node:timers/promises";
import { DataSettingsDraft } from "../data/data-settings.ts";
import { probeDataConnection } from "../data/data-readiness.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import type { DataReadiness } from "../../types/data-readiness.ts";

const probe: typeof probeDataConnection = (settings, request, options) => probeDataConnection(settings, request, { ...options,
  checkDependency: async () => ({ status: "ready", python: "fixture", akshare: "fixture" }),
  adapters: { [request.source]: { fetchBars: async () => [{ date: request.start, open: 10, high: 10, low: 10, close: 10, volume: 1, amount: 10 }] } },
});
function settings() {
  const cfg = structuredClone(DEFAULT_SETTINGS);
  cfg.preferences.source = "financial-datasets";
  cfg.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = "saved-fixture-key";
  return cfg;
}

it("binds save to the checked draft, preserves unrelated settings and invalidates every changed input", async () => {
  const cfg = settings(), before = structuredClone(cfg);
  const draft = new DataSettingsDraft(cfg, { probe, processEnv: {} });
  expect(() => draft.prepareSave()).toThrow("Check this draft");
  draft.setKey("new-fixture-key");
  await draft.verify();
  expect(draft.canSave).toBe(true);
  expect(cfg).toEqual(before);
  const saved = draft.prepareSave();
  expect(saved.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY).toBe("new-fixture-key");
  expect(saved.preferences.defaultMarket).toBe("US");
  expect(saved.model).toBe(cfg.model);
  saved.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = "caller-mutation";
  expect(draft.prepareSave().env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY).toBe("new-fixture-key");
  for (const edit of [() => draft.setSample("symbol", "MSFT"), () => draft.setSample("start", "2025-01-06"),
    () => draft.setSample("end", "2025-01-17"), () => draft.setEndpoint("http://127.0.0.1:1234"), () => draft.setKey("another-key")]) {
    edit(); expect(draft.canSave).toBe(false); expect(draft.readiness).toBeNull();
    await draft.verify(); expect(draft.canSave).toBe(true);
  }
  draft.setSource("llmquant-data");
  expect(draft.canSave).toBe(false);
  await draft.verify(); expect(draft.readiness?.status).toBe("missing-credential");
  expect(() => draft.prepareSave()).toThrow();
  draft.dispose();
});

it("supports zero-key A/Fund/US/HK checks and compatible market changes without deleting other provider credentials", async () => {
  const draft = new DataSettingsDraft(settings(), { probe, processEnv: {} });
  draft.setMarket("Fund");
  expect(draft.request).toMatchObject({ market: "Fund", source: "akshare", symbol: "270042.OF" });
  expect(draft.credentialLabel()).toBe("No key required");
  await draft.verify();
  expect(draft.readiness).toMatchObject({ status: "ready", capability: "unit-nav" });
  expect(draft.prepareSave().env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY).toBe("saved-fixture-key");
  draft.setMarket("A"); expect(draft.request.symbol).toBe("000001.SZ");
  draft.setMarket("HK"); expect(draft.request).toMatchObject({ symbol: "00700.HK", source: "akshare" });
  await draft.verify(); expect(draft.readiness?.status).toBe("ready");
  draft.setMarket("US"); expect(draft.request).toMatchObject({ symbol: "AAPL", source: "akshare" });
  await draft.verify(); expect(draft.prepareSave().env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY).toBe("saved-fixture-key");
  draft.setMarket("HK");
  expect(() => draft.setSource("financial-datasets")).toThrow("does not cover");
});

it("requires a fresh check after effective environment credentials change and supports removing a saved key", async () => {
  const env = { WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "env-fixture-key" };
  const draft = new DataSettingsDraft(settings(), { probe, processEnv: env });
  draft.removeKey(); expect(draft.credentialLabel()).toContain("Environment");
  await draft.verify(); expect(draft.canSave).toBe(true);
  env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = "changed-env-key";
  expect(draft.canSave).toBe(false); expect(() => draft.prepareSave()).toThrow();
  await draft.verify();
  expect(draft.prepareSave().env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY).toBeUndefined();
  draft.setKey(""); expect(draft.canSave).toBe(true);
});

it("settles cancellation immediately and ignores a late result after editing, a newer check or disposal", async () => {
  const pending: Array<{ finish(result: DataReadiness): void; result: DataReadiness; signal: AbortSignal }> = [];
  let changes = 0;
  const draft = new DataSettingsDraft(settings(), { processEnv: {}, onChange: () => changes++, probe: async (cfg, request, options) => {
    const result = await probe(cfg, request, options);
    return new Promise(resolve => pending.push({ finish: resolve, result, signal: options!.signal! }));
  } });
  const first = draft.verify();
  while (pending.length < 1) await setImmediate();
  draft.setSample("symbol", "MSFT"); await first;
  expect(pending[0]!.signal.aborted).toBe(true);
  const second = draft.verify();
  while (pending.length < 2) await setImmediate();
  pending[1]!.finish(pending[1]!.result); await second;
  const count = changes;
  pending[0]!.finish(pending[0]!.result); await setImmediate();
  expect(changes).toBe(count); expect(draft.readiness?.symbol).toBe("MSFT");
  const third = draft.verify();
  while (pending.length < 3) await setImmediate();
  draft.dispose(); await third;
  const closedCount = changes;
  pending[2]!.finish(pending[2]!.result); await setImmediate();
  expect(changes).toBe(closedCount); expect(draft.canSave).toBe(false);
});

it("keeps the saved connection after real adapter failure, timeout and invalid endpoints", async () => {
  const cfg = settings(), before = structuredClone(cfg);
  for (const status of [401, 403, 200, 503]) {
    const draft = new DataSettingsDraft(cfg, { processEnv: {}, probe: (s, r, o) => probeDataConnection(s, r, { ...o,
      adapters: { "financial-datasets": { fetchBars: async () => { if (status === 200) return []; throw new Error(`HTTP ${status}`); } } },
    }) });
    draft.setKey("invalid-key"); await draft.verify();
    expect(draft.canSave).toBe(false); expect(() => draft.prepareSave()).toThrow(); expect(cfg).toEqual(before);
  }
  const draft = new DataSettingsDraft(cfg, { processEnv: {}, timeoutMs: 5, probe: (s, r, o) => probeDataConnection(s, r, { ...o,
    adapters: { "financial-datasets": { fetchBars: async () => new Promise(() => {}) } },
  }) });
  await draft.verify(); expect(draft.readiness?.status).toBe("timeout"); expect(draft.checking).toBe(false);
  expect(() => draft.setEndpoint("https://user:secret@example.com/?key=secret")).toThrow("without credentials");
  expect(() => draft.setEndpoint("file:///private")).toThrow(); expect(cfg).toEqual(before);
  expect(() => draft.setEndpoint("https://example.com/\u001b[31m")).toThrow("control characters");
});
