import { afterEach, expect, it } from "bun:test";
import { setImmediate } from "node:timers/promises";
import { probeDataConnection, defaultDataProbeRequest, dataSourcesForMarket } from "../data/data-readiness.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import type { DataProbeRequest } from "../../types/data-readiness.ts";
import type { Bar } from "../../types/data.ts";

const request: DataProbeRequest = { source: "financial-datasets", market: "US", symbol: "AAPL", start: "2025-01-06", end: "2025-01-17" };
const bars: Bar[] = [6, 7].map(day => ({ date: `2025-01-0${day}`, open: 10, high: 10, low: 10, close: 10, volume: 1, amount: 10 }));
const noProxy = process.env.NO_PROXY;
const servers: Array<{ stop(close: boolean): void }> = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
});
function settings() {
  const value = structuredClone(DEFAULT_SETTINGS);
  value.preferences.source = "financial-datasets";
  value.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = "synthetic-saved-key";
  return value;
}

it("limits the sample to the selected source and uses saved credentials/endpoints before environment values", async () => {
  const seen: Array<{ path: string; key: string | null; symbol: string | null }> = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    const url = new URL(req.url); seen.push({ path: url.pathname, key: req.headers.get("x-api-key"), symbol: url.searchParams.get("ticker") });
    return Response.json({ prices: bars });
  } });
  servers.push(server); process.env.NO_PROXY = "127.0.0.1,localhost";
  const cfg = settings(); cfg.env.FINANCIAL_DATASETS_BASE_URL = String(server.url).replace(/\/$/, "");
  const before = JSON.stringify(cfg);
  const result = await probeDataConnection(cfg, request, { processEnv: { FINANCIAL_DATASETS_BASE_URL: "http://127.0.0.1:1", WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "synthetic-env-key" } });
  expect(result).toMatchObject({ status: "ready", credentialSource: "config", rowCount: 2, asOfDate: "2025-01-07", capability: "daily-bars" });
  expect(seen).toEqual([{ path: "/prices/", key: "synthetic-saved-key", symbol: "AAPL" }]);
  expect(JSON.stringify(cfg)).toBe(before);
  expect(JSON.stringify(result)).not.toContain("synthetic-saved-key");
  expect(result.action).toContain("other symbols");
});

it("distinguishes invalid/empty HTTP 200 payloads, authentication, permissions and transport failures", async () => {
  let mode = "empty";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    if (mode === "empty") return Response.json({ prices: [] });
    if (mode === "invalid") return Response.json({ prices: [{ date: "2025-01-06", close: -1 }] });
    if (mode === "broken-json") return new Response("not JSON");
    return new Response("PRIVATE_RESPONSE synthetic-saved-key", { status: Number(mode) });
  } });
  servers.push(server); process.env.NO_PROXY = "127.0.0.1,localhost";
  const cfg = settings(); cfg.env.FINANCIAL_DATASETS_BASE_URL = String(server.url).replace(/\/$/, "");
  for (const [next, expected] of [["empty", "empty"], ["invalid", "unavailable"], ["broken-json", "unavailable"], ["401", "auth-failed"], ["402", "permission-denied"], ["403", "permission-denied"], ["503", "unavailable"]] as const) {
    mode = next!;
    const result = await probeDataConnection(cfg, request, { processEnv: {} });
    expect(result.status).toBe(expected!); expect(result.rowCount).toBe(0); expect(result.asOfDate).toBeNull();
    expect(JSON.stringify(result)).not.toContain("PRIVATE_RESPONSE"); expect(JSON.stringify(result)).not.toContain("synthetic-saved-key");
  }
});

it("requires a credential before I/O and rejects incompatible markets, wrong identities and invalid dates", async () => {
  let calls = 0;
  const adapter = { fetchBars: async () => { calls++; return bars; } };
  const cfg = structuredClone(DEFAULT_SETTINGS);
  expect((await probeDataConnection(cfg, request, { processEnv: {}, adapters: { "financial-datasets": adapter } })).status).toBe("missing-credential");
  const configured = settings();
  for (const invalid of [{ ...request, market: "HK" as const }, { ...request, symbol: "000001.SZ" }, { ...request, start: "2025-02-30" }]) {
    const result = await probeDataConnection(configured, invalid, { processEnv: {}, adapters: { "financial-datasets": adapter } });
    expect(["unsupported", "invalid-input"]).toContain(result.status);
  }
  expect(calls).toBe(0);
  expect(dataSourcesForMarket("HK")).toEqual(["llmquant-data", "akshare"]);
});

it("probes public US/HK samples without credentials or unrelated provider fallback", async () => {
  const seen: string[] = [];
  const adapter = { fetchBars: async ({ symbol }: { symbol: string }) => { seen.push(symbol); return bars; } };
  for (const [market, symbol] of [["US", "AAPL"], ["HK", "00700.HK"]] as const) {
    const result = await probeDataConnection(DEFAULT_SETTINGS, { ...request, source: "akshare", market, symbol }, {
      processEnv: {}, adapters: { akshare: adapter }, checkDependency: async () => ({ status: "ready" }),
    });
    expect(result).toMatchObject({ status: "ready", credentialSource: "not-required", capability: "daily-bars", rowCount: 2 });
  }
  expect(seen).toEqual(["AAPL", "00700.HK"]);
});

it("separates missing Python/package from actual zero-key AKShare data readiness and preserves fund identity", async () => {
  let calls = 0, seen = "";
  const fund: DataProbeRequest = { ...request, source: "akshare", market: "Fund", symbol: "270042" };
  const adapters = { akshare: { fetchBars: async ({ symbol }: { symbol: string }) => { calls++; seen = symbol; return bars; } } };
  for (const status of ["missing-python", "missing-package"] as const) {
    const result = await probeDataConnection(DEFAULT_SETTINGS, fund, { processEnv: {}, adapters, checkDependency: async () => ({ status }) });
    expect(result.status).toBe(status); expect(result.credentialSource).toBe("not-required");
  }
  expect(calls).toBe(0);
  const ready = await probeDataConnection(DEFAULT_SETTINGS, fund, { processEnv: {}, adapters, checkDependency: async () => ({ status: "ready", python: "3.12", akshare: "fixture" }) });
  expect(ready).toMatchObject({ status: "ready", symbol: "270042.OF", capability: "unit-nav", rowCount: 2 });
  expect(calls).toBe(1); expect(seen).toBe("270042.OF");
});

it("never disguises a failing selected source with fallback data or data outside the requested window", async () => {
  let fallbackCalls = 0;
  const cfg = settings(); cfg.env.WHYJ_QUANT_LLMQUANT_API_KEY = "fixture";
  const result = await probeDataConnection(cfg, request, { processEnv: {}, adapters: {
    "financial-datasets": { fetchBars: async () => { throw new Error("HTTP 401"); } },
    "llmquant-data": { fetchBars: async () => { fallbackCalls++; return bars; } },
  } });
  expect(result.status).toBe("auth-failed"); expect(fallbackCalls).toBe(0);
  const outside = await probeDataConnection(cfg, { ...request, start: "2025-01-08" }, { processEnv: {}, adapters: {
    "financial-datasets": { fetchBars: async () => bars },
  } });
  expect(outside.status).toBe("empty");
});

it("classifies redacted provider authentication and permission errors without exposing their original text", async () => {
  const privateText = "PRIVATE_PROVIDER_RESPONSE_AND_HEADER";
  for (const [message, status] of [[`invalid token ${privateText}`, "auth-failed"], [`permission denied ${privateText}`, "permission-denied"]] as const) {
    const result = await probeDataConnection(settings(), request, { processEnv: {}, adapters: {
      "financial-datasets": { fetchBars: async () => { throw new Error(message); } },
    } });
    expect(result.status).toBe(status);
    expect(JSON.stringify(result)).not.toContain(privateText);
  }
});

it("bounds uncooperative providers, distinguishes cancellation from timeout, and ignores late results", async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController(); let release!: (bars: Bar[]) => void, signal: AbortSignal | undefined;
    const pending = probeDataConnection(settings(), request, { processEnv: {}, signal: controller.signal, timeoutMs: 10,
      adapters: { "financial-datasets": { fetchBars: async input => { signal = input.signal; return new Promise(resolve => { release = resolve; }); } } } });
    if (cancel) controller.abort(new Error("PRIVATE_CANCEL_REASON"));
    const result = await pending;
    expect(result.status).toBe(cancel ? "cancelled" : "timeout"); expect(signal?.aborted).toBe(true);
    const before = JSON.stringify(result); release(bars); await setImmediate();
    expect(JSON.stringify(result)).toBe(before); expect(before).not.toContain("PRIVATE_CANCEL_REASON");
  }
});

it("chooses an explicit compatible default sample and performs no I/O after prior cancellation", async () => {
  const cfg = settings(); cfg.preferences.defaultMarket = "HK";
  expect(defaultDataProbeRequest(cfg, new Date("2025-02-01T00:00:00Z"))).toEqual({ ...request, start: "2025-01-02", end: "2025-02-01" });
  cfg.preferences.source = "llmquant-data";
  expect(defaultDataProbeRequest(cfg).market).toBe("HK");
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const result = await probeDataConnection(cfg, request, { signal: controller.signal, processEnv: {}, adapters: {
    "financial-datasets": { fetchBars: async () => { calls++; return bars; } },
  } });
  expect(result.status).toBe("cancelled"); expect(calls).toBe(0);
});
