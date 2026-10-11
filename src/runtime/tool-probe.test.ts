import { expect, it, spyOn } from "bun:test";
import * as source from "../source/index.ts";
import { setImmediate } from "node:timers/promises";
import { DEFAULT_SETTINGS } from "../types/config.ts";
import { probeToolEndpoint, toolProbeChoices, formatToolProbe, defaultToolProbeRequest, type ToolProbeOptions } from "./tool-probe.ts";
import { ToolProbeDraft } from "./tool-probe-draft.ts";
import { listBuiltinToolCapabilities } from "../tools/registry.ts";
import { executeCommand, parseCommand } from "../cli/registry.ts";
import { toolProbeDoctor } from "../cli/handlers/tool-probe.ts";
import type { ToolProbeRequest } from "../types/tool-probe.ts";
import type { AkshareRowsResult } from "../source/index.ts";

const readyPython = async () => ({ status: "ready" as const, python: "fixture", akshare: "fixture" });
const fund: ToolProbeRequest = { tool: "akshare_fund_fund_open_fund_info_em", provider: "akshare", endpoint: "fund_open_fund_info_em",
  market: "Fund", params: { symbol: "270042", indicator: "单位净值走势" } };

it.each([
  { tool: "akshare_fund_fund_individual_basic_info_xq", key: "timeout", args: "--symbol 000001", valid: "1.5", expected: 1.5 },
  { tool: "akshare_fund_fund_fh_em", key: "page", args: "--year 2026", valid: "-1", expected: -1 },
])("rejects a missing or empty numeric --$key before checking Python instead of coercing it", async ({ tool, key, args, valid, expected }) => {
  const dependency = spyOn(source, "checkAkshareDependency").mockResolvedValue({ status: "missing-python" });
  try {
    for (const suffix of ["", ' ""', ' " "', " nonsense", " Infinity"]) {
      const parsed = parseCommand(`/doctor --tool ${tool} --market Fund ${args} --${key}${suffix}`)!;
      const result = await toolProbeDoctor(DEFAULT_SETTINGS, parsed.flags);
      expect(result.success).toBe(false);
      expect(result.data).toMatchObject({ status: "invalid-input", params: {} });
    }
    expect(dependency).not.toHaveBeenCalled();
    const parsed = parseCommand(`/doctor --tool ${tool} --market Fund ${args} --${key} ${valid}`)!;
    const result = await toolProbeDoctor(DEFAULT_SETTINGS, parsed.flags);
    expect(result.data).toMatchObject({ status: "missing-python", params: { [key]: expected, ...(key === "page" ? { year: "2026" } : { symbol: "000001" }) } });
    expect(dependency).toHaveBeenCalledTimes(1);
  } finally { dependency.mockRestore(); }
});

it("probes exactly one declared AKShare endpoint, validates shared arguments, and never trusts rowCount alone", async () => {
  const cfg = structuredClone(DEFAULT_SETTINGS); cfg.preferences.source = "tushare";
  const before = JSON.stringify(cfg); let calls = 0;
  const options: ToolProbeOptions = { processEnv: {}, checkDependency: readyPython, adapters: { fundRows: async (endpoint, params = {}) => {
    calls++; expect(endpoint).toBe("fund_open_fund_info_em"); expect(params).toEqual(fund.params);
    return { endpoint, params, fetchedAt: "fixture", rowCount: 999, rows: calls === 1 ? [{ 日期: "2025-01-06", 单位净值: 1.25 }] : [{}, { value: null }, { value: " " }, { value: NaN }] };
  } } };
  const verified = await probeToolEndpoint(cfg, fund, options);
  expect(verified).toMatchObject({ status: "ready", rowCount: 1, scope: "endpoint-response", params: fund.params });
  expect(verified.action).toContain("other endpoints");
  expect((await probeToolEndpoint(cfg, fund, options)).status).toBe("empty");
  const invalidParams: ToolProbeRequest["params"][] = [{}, { symbol: "" }, { symbol: "270042", fund_code: "270042" }, { symbol: "270042", token: "must-not-echo" }];
  for (const params of invalidParams) {
    const invalid = await probeToolEndpoint(cfg, { ...fund, params }, options);
    expect(invalid.status).toBe("invalid-input"); expect(formatToolProbe(invalid)).not.toContain("must-not-echo");
  }
  expect((await probeToolEndpoint(cfg, { ...fund, endpoint: "fund_fee_em" }, options)).status).toBe("unsupported");
  expect(calls).toBe(2); expect(JSON.stringify(cfg)).toBe(before);
});

it("keeps catalogue permissions separate from prices and classifies actual HTTP responses without exposing credentials", async () => {
  const noProxy = process.env.NO_PROXY; process.env.NO_PROXY = "127.0.0.1,localhost";
  let mode = "ready", calls = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    calls++; const body = await req.json() as { api_name: string; token: string; params: Record<string, unknown> };
    expect(body.api_name).toBe("stock_basic"); expect(body.token).toBe("saved-token"); expect(body.params).toEqual({ name: "平安银行", list_status: "L" });
    if (/^\d+$/.test(mode)) return new Response("saved-token", { status: Number(mode) });
    if (mode === "permission") return Response.json({ code: -1, msg: "权限不足 saved-token" });
    return Response.json({ code: 0, data: { fields: ["ts_code", "name"], items: mode === "ready" ? [["000001.SZ", "平安银行"]] : mode === "invalid" ? [["", ""]] : [] } });
  } });
  const cfg = structuredClone(DEFAULT_SETTINGS); cfg.env = { WHYJ_QUANT_TUSHARE_TOKEN: "saved-token", TUSHARE_BASE_URL: server.url.href };
  const request: ToolProbeRequest = { tool: "search_symbols", provider: "tushare", endpoint: "stock_basic", market: "A", params: { keyword: "平安银行" } };
  try {
    for (const [response, status] of [["ready", "ready"], ["empty", "empty"], ["invalid", "empty"], ["401", "auth-failed"], ["403", "permission-denied"], ["permission", "permission-denied"], ["503", "unavailable"]] as const) {
      mode = response; const result = await probeToolEndpoint(cfg, request, { processEnv: { WHYJ_QUANT_TUSHARE_TOKEN: "env-token" } });
      expect(result.status).toBe(status); expect(JSON.stringify(result)).not.toMatch(/saved-token|env-token/);
    }
    mode = "ready";
    const command = await toolProbeDoctor(cfg, { tool: "search_symbols", market: "A", keyword: "平安银行" });
    expect(command.success).toBe(true); expect(command.data).toMatchObject({ endpoint: "stock_basic", rowCount: 1 });
    const count = calls;
    expect((await toolProbeDoctor(cfg, { tool: "search_symbols", market: "US", keyword: "AAPL" })).success).toBe(false);
    expect((await probeToolEndpoint({ ...cfg, env: { ...cfg.env, WHYJ_QUANT_TUSHARE_TOKEN: "" } }, request, { processEnv: { WHYJ_QUANT_TUSHARE_TOKEN: "env-token" } })).status).toBe("missing-credential");
    expect(calls).toBe(count);
  } finally { await server.stop(true); if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy; }
});

it("checks prerequisites only for the selected route and stops timeout/cancellation before accepting late responses", async () => {
  let calls = 0;
  const missing = await probeToolEndpoint(DEFAULT_SETTINGS, fund, { processEnv: {}, checkDependency: async () => ({ status: "missing-package" }),
    adapters: { fundRows: async () => { calls++; throw new Error("Must not call"); } } });
  expect(missing.status).toBe("missing-package"); expect(calls).toBe(0);
  const sina = defaultToolProbeRequest(DEFAULT_SETTINGS, "fetch_index_spot", "A")!;
  sina.provider = "sina"; sina.endpoint = "index-quotes"; sina.params = { symbol: "000300" };
  const publicResult = await probeToolEndpoint(DEFAULT_SETTINGS, sina, { processEnv: {}, checkDependency: async () => { throw new Error("Must not check Python for Sina"); }, adapters: { sina: async () => [] } });
  expect(publicResult.status).toBe("empty");
  let signal: AbortSignal | undefined, resolve!: (value: AkshareRowsResult) => void;
  const controller = new AbortController();
  const task = probeToolEndpoint(DEFAULT_SETTINGS, fund, { signal: controller.signal, checkDependency: readyPython, adapters: { fundRows: async (_endpoint, _params, s) => {
    signal = s; return new Promise(r => { resolve = r; });
  } } });
  while (!signal) await setImmediate(); controller.abort();
  const cancelled = await task; expect(cancelled.status).toBe("cancelled"); expect(signal.aborted).toBe(true);
  resolve({ endpoint: "fund_open_fund_info_em", params: {}, fetchedAt: "late", rowCount: 1, rows: [{ value: 1 }] });
  await setImmediate(); expect(cancelled.rowCount).toBe(0);
  const timed = await probeToolEndpoint(DEFAULT_SETTINGS, fund, { timeoutMs: 5, checkDependency: async () => new Promise(() => {}) });
  expect(timed.status).toBe("timeout");
});

it("keeps probe discovery aligned with registry routes and exposes no shell/compute execution path", async () => {
  const manifest = listBuiltinToolCapabilities();
  for (const tool of manifest) for (const market of ["A", "US", "HK", "Fund"] as const) {
    const choices = toolProbeChoices(tool.name, market);
    for (const choice of choices) expect(tool.requirements.routes.some(route => route.provider === choice.provider && route.markets.includes(market))).toBe(true);
    if (tool.requirements.routes.every(route => route.provider === "local")) expect(choices).toEqual([]);
  }
  expect((await executeCommand(parseCommand("/doctor --tool bash --market A")!)).success).toBe(false);
  expect(defaultToolProbeRequest(DEFAULT_SETTINGS, "run_backtest", "A")!.endpoint).toBe("daily-series");
});

it("invalidates editor evidence on changed parameters/credentials and discards late results on disposal", async () => {
  const env: Record<string, string | undefined> = { WHYJ_QUANT_TUSHARE_TOKEN: "initial" };
  let redraws = 0;
  const context = { settings: DEFAULT_SETTINGS, market: "A" as const, processEnv: env, onChange: () => { redraws++; },
    probe: ((cfg, request, options) => probeToolEndpoint(cfg, request, { ...options, adapters: { search: async () => [{ code: "000001.SZ", name: "平安银行", market: "A", exchange: "SZSE", type: "stock" }] } })) satisfies typeof probeToolEndpoint };
  const draft = new ToolProbeDraft("search_symbols", context);
  await draft.verify(); expect(draft.result?.status).toBe("ready"); expect(redraws).toBe(2);
  env.WHYJ_QUANT_TUSHARE_TOKEN = "replacement"; expect(draft.result).toBeNull(); expect(draft.status).toContain("Connection changed");
  await draft.verify(); draft.setParams('{"keyword":"招商银行"}'); expect(draft.result).toBeNull();
  let resolve!: (value: Awaited<ReturnType<typeof probeToolEndpoint>>) => void;
  const late = new ToolProbeDraft("search_symbols", { ...context, probe: async () => new Promise(r => { resolve = r; }) });
  const check = late.verify(); late.dispose(); await check;
  resolve(await probeToolEndpoint(DEFAULT_SETTINGS, { ...fund, params: {} })); await setImmediate();
  expect(late.result).toBeNull(); expect(late.checking).toBe(false); draft.dispose();
});
