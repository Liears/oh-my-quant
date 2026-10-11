import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import { parseCommand, executeCommand } from "../cli/registry.ts";
import { AppRuntime } from "../app-runtime.ts";
import { toolProbeDoctor } from "../cli/handlers/tool-probe.ts";
import { listBuiltinToolCapabilities } from "../tools/registry.ts";
import { AKSHARE_PUBLIC_INDEX_ENDPOINTS } from "../source/index.ts";
import { AKSHARE_INDEX_SIGNATURE_VERSION, AKSHARE_INDEX_SIGNATURES } from "./akshare-index-signatures.generated.ts";
import { toolProbeChoices, validToolProbeParameters, TOOL_PROBE_PARAMETER_RULES } from "./tool-probe-catalog.ts";
import { toolProbeSchemaResult } from "./tool-probe-schema.ts";
import { installedAkshareIndexSchemaResult, type AkshareIndexInspector } from "./installed-akshare-index-schema.ts";
import { commandPreflight } from "./command-preflight.ts";
import { probeToolEndpoint } from "./tool-probe.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";

let root: string, previous: string | undefined, network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-probe-schema-")); process.env.OHQUANT_DIR = root;
  writeFileSync(join(root, "settings.json"), "INVALID_SETTINGS_SCHEMA_MUST_NOT_READ");
  network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in schema discovery"));
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); network.mockRestore();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected schema fixture directory");
  rmSync(root, { recursive: true, force: true });
});

type ParameterSchema = TSchema & { default?: unknown; description?: string; enum?: string[]; pattern?: string; format?: string };
interface SchemaData { kind: string; scope: string; routes: Array<{ provider: string; endpoint: string; parameters: TSchema & { required?: string[]; additionalProperties?: boolean; properties?: Record<string, ParameterSchema> }; parameterContract: string }>; parameterRules: { maxProperties: number }; signatureSources?: { akshareIndex?: string }; comparison?: { packagedVersion: string; versionMatches: boolean; matchesPackaged: boolean; changedEndpoints: string[] } }

test("fund schema exposes real required fields and number types, excluding tool-only filters", async () => {
  const tool = "akshare_fund_fund_individual_basic_info_xq";
  const result = await executeCommand(parseCommand(`/doctor --tool ${tool} --market Fund --schema`)!);
  expect(result.success).toBe(true); expect(result.effects).toBeUndefined();
  const data = result.data as SchemaData, route = data.routes[0]!;
  expect(data).toMatchObject({ kind: "tool-probe-schemas", scope: "static-declarations" });
  expect(route.parameterContract).toBe("declared-parameters");
  expect(Check(route.parameters, {})).toBe(false);
  expect(Check(route.parameters, { symbol: "000001", timeout: 1.5 })).toBe(true);
  expect(Check(route.parameters, { symbol: "000001", timeout: "1.5" })).toBe(false);
  expect(Check(route.parameters, { symbol: "000001", limit: 10 })).toBe(false);
  expect(data.parameterRules).toEqual(TOOL_PROBE_PARAMETER_RULES);
  let dependencies = 0;
  const probe = await probeToolEndpoint(DEFAULT_SETTINGS, { tool, provider: "akshare", endpoint: route.endpoint, market: "Fund", params: { symbol: "000001", timeout: true } },
    { checkDependency: async () => { dependencies++; return { status: "missing-python" }; } });
  expect(probe.status).toBe("invalid-input"); expect(dependencies).toBe(0);
  expect((await toolProbeDoctor(DEFAULT_SETTINGS, { schema: true, tool, market: "Fund" })).data).toEqual(result.data);
});

test("daily, news and FX schemas disclose calendar dates and reject inverted windows before adapters", async () => {
  const routes = [
    { tool: "fetch_bars", market: "US" as const, provider: "akshare" as const, endpoint: "daily-series", symbol: "AAPL" },
    { tool: "research_news", market: "A" as const, provider: "akshare" as const, endpoint: "stock_news_em", symbol: "000001.SZ" },
    { tool: "compare_portfolios", market: "US" as const, provider: "frankfurter" as const, endpoint: "ecb-fx", base: "USD", quote: "CNY" },
  ];
  let dependencies = 0, adapters = 0;
  const options = { processEnv: {}, checkDependency: async () => { dependencies++; return { status: "ready" as const }; },
    adapters: { daily: async () => { adapters++; throw new Error("Unexpected daily request"); },
      news: async () => { adapters++; throw new Error("Unexpected news request"); },
      fx: async () => { adapters++; throw new Error("Unexpected FX request"); } } };
  for (const route of routes) {
    const schema = toolProbeChoices(route.tool, route.market).find(choice => choice.provider === route.provider && choice.endpoint === route.endpoint)!.parameters;
    const base: Record<string, string> = route.endpoint === "ecb-fx"
      ? { base: route.base!, quote: route.quote! } : { symbol: route.symbol! };
    expect((schema as TSchema & { properties: Record<string, ParameterSchema> }).properties.start.pattern).toBe("^[0-9]{4}-[0-9]{2}-[0-9]{2}$");
    expect((schema as TSchema & { properties: Record<string, ParameterSchema> }).properties.start.format).toBe("whyj-daily-date");
    expect(Check(schema, { ...base, start: "2024-02-29", end: "2024-03-01" })).toBe(true);
    expect(Check(schema, { ...base, start: "2025-02-29", end: "2025-03-01" })).toBe(false);
    expect(Check(schema, { ...base, start: "2025/01/06", end: "2025-01-17" })).toBe(false);
    const request = { tool: route.tool, market: route.market, provider: route.provider, endpoint: route.endpoint };
    const invalidCalendar = await probeToolEndpoint(DEFAULT_SETTINGS, { ...request,
      params: { ...base, start: "2025-02-29", end: "2025-03-01" } }, options);
    expect(invalidCalendar.status).toBe("invalid-input");
    expect(invalidCalendar.action).toContain("Dates must be valid YYYY-MM-DD values");
    expect(invalidCalendar.params).toEqual({});
    const invalid = await probeToolEndpoint(DEFAULT_SETTINGS, { ...request,
      params: { ...base, start: "2025-01-17", end: "2025-01-06" } }, options);
    expect(invalid.status).toBe("invalid-input");
    expect(invalid.action).toContain("Start date must be on or before end date");
    expect(invalid.params).toEqual({});
  }
  expect(dependencies).toBe(0); expect(adapters).toBe(0);
});

test("all whitelisted index endpoints disclose the installed signature snapshot and reject undeclared parameters", () => {
  expect(Object.keys(AKSHARE_INDEX_SIGNATURES)).toEqual([...AKSHARE_PUBLIC_INDEX_ENDPOINTS]);
  const result = toolProbeSchemaResult({ schema: true, tool: "fetch_index_rows", market: "A" }, []);
  expect(result.success).toBe(true);
  const data = result.data as SchemaData;
  expect(data.signatureSources?.akshareIndex).toBe(AKSHARE_INDEX_SIGNATURE_VERSION);
  expect(data.routes).toHaveLength(AKSHARE_PUBLIC_INDEX_ENDPOINTS.length);
  for (const route of data.routes) {
    expect(route.parameterContract).toBe("declared-parameters");
    expect(Object.keys(route.parameters.properties ?? {})).toEqual(Object.keys(AKSHARE_INDEX_SIGNATURES[route.endpoint as keyof typeof AKSHARE_INDEX_SIGNATURES].parameters));
    expect(route.parameters.additionalProperties).toBe(false);
  }
  const noArgs = data.routes.find(route => route.endpoint === "index_stock_info")!;
  expect(validToolProbeParameters(noArgs.parameters, {})).toBe(true);
  expect(validToolProbeParameters(noArgs.parameters, { arbitrary_api_parameter: "000001" })).toBe(false);
  const history = data.routes.find(route => route.endpoint === "index_zh_a_hist")!;
  expect(history.parameters.properties?.symbol.default).toBe("000859");
  expect(history.parameters.properties?.period.description).toContain("daily");
  expect(validToolProbeParameters(history.parameters, { symbol: "000300", period: "daily", start_date: "20250101", end_date: "20250117" })).toBe(true);
  expect(validToolProbeParameters(history.parameters, { period: true })).toBe(false);
  expect(validToolProbeParameters(history.parameters, { unlisted: "x" })).toBe(false);
  const invalid: Record<string, string | number | boolean>[] = [{ value: " " }, { value: "x".repeat(513) }, { value: "bad\ntext" }, { value: Infinity }, { token: "synthetic-secret" },
    Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`key${index}`, true]))];
  for (const params of invalid) expect(validToolProbeParameters(history.parameters, params)).toBe(false);
});

test("documented index choices and date shapes are disclosed and checked before Python", async () => {
  const result = toolProbeSchemaResult({ schema: true, tool: "fetch_index_rows", market: "A" }, []);
  expect(result.success).toBe(true);
  const routes = (result.data as SchemaData).routes;
  const route = (endpoint: string) => routes.find(item => item.endpoint === endpoint)!;
  const daily = route("index_zh_a_hist").parameters;
  expect(daily.properties?.period.enum).toEqual(["daily", "weekly", "monthly"]);
  expect(daily.properties?.start_date.pattern).toBe("^[0-9]{8}$");
  expect(daily.properties?.start_date.format).toBe("whyj-akshare-ymd8");
  expect(Check(daily, { period: "hourly" })).toBe(false);
  expect(Check(daily, { period: "weekly", start_date: "2025-01-01" })).toBe(false);
  expect(Check(daily, { start_date: "20250230" })).toBe(false);
  expect(Check(daily, { start_date: "20240229" })).toBe(true);
  expect(Check(daily, { start_date: "19000229" })).toBe(false);
  expect(Check(daily, { start_date: "20000229" })).toBe(true);
  expect(Check(daily, { start_date: "00000101" })).toBe(false);
  expect(Check(daily, { end_date: "20251301" })).toBe(false);
  expect(Check(daily, { period: "weekly", start_date: "20250101", end_date: "20250117" })).toBe(true);

  const minute = route("index_zh_a_hist_min_em").parameters;
  expect(minute.properties?.period.enum).toEqual(["1", "5", "15", "30", "60"]);
  expect(minute.properties?.start_date.pattern).toBe("^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$");
  expect(minute.properties?.start_date.format).toBe("whyj-akshare-datetime-seconds");
  expect(Check(minute, { period: "2" })).toBe(false);
  expect(Check(minute, { period: "5", start_date: "20250101" })).toBe(false);
  expect(Check(minute, { start_date: "2025-02-29 09:30:00" })).toBe(false);
  expect(Check(minute, { start_date: "2024-02-29 23:59:59" })).toBe(true);
  expect(Check(minute, { start_date: "2024-02-29 23:60:00" })).toBe(false);
  expect(Check(minute, { end_date: "2025-01-01 24:00:00" })).toBe(false);
  expect(Check(minute, { period: "5", start_date: "2025-01-01 09:30:00" })).toBe(true);
  expect(route("index_hist_sw").parameters.properties?.period.enum).toEqual(["day", "week", "month"]);
  expect(route("stock_zh_index_spot_em").parameters.properties?.symbol.enum).toContain("中证系列指数");
  expect(route("drewry_wci_index").parameters.properties?.symbol.enum).toEqual(["composite", "shanghai-rotterdam", "rotterdam-shanghai",
    "shanghai-los angeles", "los angeles-shanghai", "shanghai-genoa", "new york-rotterdam", "rotterdam-new york"]);
  let documentedChoices = 0;
  for (const item of routes) for (const [name, parameter] of Object.entries(AKSHARE_INDEX_SIGNATURES[item.endpoint as keyof typeof AKSHARE_INDEX_SIGNATURES].parameters)) {
    if (!parameter.description?.includes("choice of")) continue;
    documentedChoices++;
    expect(item.parameters.properties?.[name]?.enum?.length).toBeGreaterThan(1);
    if (typeof parameter.default === "string") expect(item.parameters.properties?.[name]?.enum).toContain(parameter.default);
  }
  expect(documentedChoices).toBe(19);

  const base = { tool: "fetch_index_rows", provider: "akshare" as const, market: "A" as const, endpoint: "index_zh_a_hist" };
  let dependencies = 0, requests = 0;
  const adapters = { checkDependency: async () => { dependencies++; return { status: "ready" as const }; },
    adapters: { indexRows: async () => { requests++; return { endpoint: "index_zh_a_hist" as const, params: {}, fetchedAt: "fixture", rowCount: 1, rows: [{ 日期: "2025-01-06", 收盘: 1000 }] }; } } };
  for (const params of [{ period: "hourly" }, { period: "weekly", start_date: "2025-01-01" },
    { start_date: "20250230" }, { start_date: "20250117", end_date: "20250101" }, { start_date: "22220102" }] as Array<Record<string, string>>) {
    expect((await probeToolEndpoint(DEFAULT_SETTINGS, { ...base, params }, adapters)).status).toBe("invalid-input");
  }
  for (const params of [{ start_date: "2025-02-29 09:30:00" },
    { start_date: "2025-01-17 09:30:00", end_date: "2025-01-16 16:00:00" },
    { start_date: "2222-01-01 09:32:01" }] as Array<Record<string, string>>) {
    expect((await probeToolEndpoint(DEFAULT_SETTINGS, { ...base, endpoint: "index_zh_a_hist_min_em", params }, adapters)).status).toBe("invalid-input");
  }
  const inverted = await probeToolEndpoint(DEFAULT_SETTINGS, { ...base, params: { start_date: "20250117", end_date: "20250101" } }, adapters);
  expect(inverted.action).toContain("Start date must not follow end date");
  const invalidCalendar = await probeToolEndpoint(DEFAULT_SETTINGS, { ...base, params: { start_date: "20250230" } }, adapters);
  expect(invalidCalendar.action).toContain("valid calendar dates");
  expect(dependencies).toBe(0); expect(requests).toBe(0);
});

test("index endpoint probe uses the discovered fields before Python and forwards valid names unchanged", async () => {
  let dependencies = 0, calls = 0;
  const adapters = { checkDependency: async () => {
    dependencies++;
    return { status: "ready" as const, python: "fixture", akshare: AKSHARE_INDEX_SIGNATURE_VERSION };
  }, adapters: { indexRows: async (endpoint: typeof AKSHARE_PUBLIC_INDEX_ENDPOINTS[number], params: Record<string, unknown> = {}) => {
    calls++; expect(endpoint).toBe("index_zh_a_hist");
    expect(params).toEqual({ symbol: "000300", period: "daily", start_date: "20250101", end_date: "20250117" });
    return { endpoint, params, fetchedAt: "fixture", rowCount: 1, rows: [{ 日期: "2025-01-06", 收盘: 1000 }] };
  } } };
  const base = { tool: "fetch_index_rows", provider: "akshare" as const, market: "A" as const };
  const invalid = await probeToolEndpoint(DEFAULT_SETTINGS, { ...base, endpoint: "index_stock_info", params: { invented: "x" } }, adapters);
  expect(invalid.status).toBe("invalid-input"); expect(dependencies).toBe(0); expect(calls).toBe(0);
  const valid = await probeToolEndpoint(DEFAULT_SETTINGS, { ...base, endpoint: "index_zh_a_hist",
    params: { symbol: "000300", period: "daily", start_date: "20250101", end_date: "20250117" } }, adapters);
  expect(valid.status).toBe("ready"); expect(valid.rowCount).toBe(1);
  expect(dependencies).toBe(1); expect(calls).toBe(1);
});

test("explicit installed index schema query defers only the validated read-only route", () => {
  const valid = parseCommand('/doctor --tool fetch_index_rows --market A --schema --installed --endpoint index_stock_info')!;
  expect(commandPreflight(valid)).toBeUndefined();
  for (const input of ['/doctor --tool fetch_index_rows --market A --schema --installed false',
    '/doctor --tool fetch_bars --market US --schema --installed', '/doctor --tool fetch_index_rows --market A --installed',
    '/doctor --tool fetch_index_rows --market A --schema --installed --symbol 000300']) {
    expect(commandPreflight(parseCommand(input)!)?.success).toBe(false);
  }
});

test("installed index schema reports field drift separately from package version drift", async () => {
  const flags = { schema: true, installed: true, tool: "fetch_index_rows", market: "A", endpoint: "index_stock_info" };
  const inspect: AkshareIndexInspector = async endpoints => {
    expect(endpoints).toEqual(["index_stock_info"]);
    return { version: "fixture-new-version", signatures: { index_stock_info: { parameters: { symbol: { type: "string", required: true,
      description: "choice of {'000300', '000001'}" } } } } };
  };
  const result = await installedAkshareIndexSchemaResult(flags, [], { inspect });
  expect(result.success).toBe(true);
  const data = result.data as SchemaData;
  expect(data).toMatchObject({ kind: "tool-probe-schemas", scope: "installed-signatures",
    signatureSources: { akshareIndex: "fixture-new-version" }, comparison: { packagedVersion: AKSHARE_INDEX_SIGNATURE_VERSION,
      versionMatches: false, matchesPackaged: false, changedEndpoints: ["index_stock_info"] } });
  expect(Check(data.routes[0]!.parameters, {})).toBe(false);
  expect(Check(data.routes[0]!.parameters, { symbol: "000300" })).toBe(true);
  expect(data.routes[0]!.parameters.properties?.symbol.enum).toEqual(["000300", "000001"]);
  expect(Check(data.routes[0]!.parameters, { symbol: "OTHER" })).toBe(false);
  expect(Check(data.routes[0]!.parameters, { invented: "x" })).toBe(false);

  const sameFields = await installedAkshareIndexSchemaResult(flags, [], { inspect: async () => ({ version: "fixture-new-version",
    signatures: { index_stock_info: structuredClone(AKSHARE_INDEX_SIGNATURES.index_stock_info) } }) });
  expect((sameFields.data as SchemaData).comparison).toEqual({ packagedVersion: AKSHARE_INDEX_SIGNATURE_VERSION,
    versionMatches: false, matchesPackaged: true, changedEndpoints: [] });
});

test("installed index schema fails safely on missing package, invalid route and cancellation", async () => {
  let inspections = 0;
  const inspect: AkshareIndexInspector = async () => { inspections++; throw new Error("missing-package"); };
  const flags = { schema: true, installed: true, tool: "fetch_index_rows", market: "A", endpoint: "index_stock_info" };
  const missing = await installedAkshareIndexSchemaResult(flags, [], { inspect });
  expect(missing.success).toBe(false); expect(missing.message).toContain("AKShare is not installed"); expect(inspections).toBe(1);
  const invalid = await installedAkshareIndexSchemaResult({ ...flags, endpoint: "not_public" }, [], { inspect });
  expect(invalid.success).toBe(false); expect(inspections).toBe(1);
  const cancelled = new AbortController(); cancelled.abort();
  const aborted = await installedAkshareIndexSchemaResult(flags, [], { signal: cancelled.signal, inspect });
  expect(aborted.success).toBe(false); expect(aborted.message).toContain("cancelled"); expect(inspections).toBe(1);
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_SETTINGS_SCHEMA_MUST_NOT_READ");
});

test("discovery covers every declared tool-market route and returns independent schema copies", () => {
  for (const tool of listBuiltinToolCapabilities()) for (const market of ["A", "US", "HK", "Fund"] as const) {
    const expected = toolProbeChoices(tool.name, market), result = toolProbeSchemaResult({ schema: true, tool: tool.name, market }, []);
    expect(result.success).toBe(expected.length > 0);
    if (expected.length) expect((result.data as SchemaData).routes.map(({ parameterContract: _contract, ...route }) => route)).toEqual(expected);
  }
  const flags = { schema: true, tool: "fetch_bars", market: "US", provider: "financial-datasets" };
  const first = toolProbeSchemaResult(flags, []).data as SchemaData;
  first.routes[0]!.parameters.required = []; first.parameterRules.maxProperties = 0;
  const second = toolProbeSchemaResult(flags, []).data as SchemaData;
  expect(Check(second.routes[0]!.parameters, {})).toBe(false); expect(second.parameterRules.maxProperties).toBe(30);
});

test("invalid schema queries, unsupported routes and help cannot fall through to probes", async () => {
  const forbidden = () => { throw new Error("No Doctor action"); };
  for (const input of ['/doctor --schema', '/doctor --tool fetch_bars --schema', '/doctor --tool fetch_bars --market WRONG --schema',
    '/doctor --tool fetch_bars --market US --schema false', '/doctor --tool fetch_bars --market US --schema --symbol AAPL',
    '/doctor --tool fetch_bars --market US --schema --phase data', '/doctor --tool fetch_bars --market US --schema extra',
    '/doctor --tool fetch_bars --market US --schema --provider', '/doctor --tool fetch_bars --market US --schema --endpoint ""',
    '/doctor --tool fetch_bars --market US --schema --provider sina', '/doctor --tool bash --market US --schema', '/doctor --tool absent --market A --schema']) {
    const result = await executeCommand(parseCommand(input)!, { openDoctor: forbidden });
    expect(result.success).toBe(false); expect(result.effects).toBeUndefined();
    expect((await toolProbeDoctor(DEFAULT_SETTINGS, parseCommand(input)!.flags)).success).toBe(false);
  }
  const help = await executeCommand(parseCommand('/doctor --schema --help')!, { openDoctor: forbidden });
  expect(help.success).toBe(true); expect(help.message).toContain("--schema reads static endpoint parameters");
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_SETTINGS_SCHEMA_MUST_NOT_READ");
});

test("AppRuntime shows schema output without changing activity or initializing model and data", async () => {
  const messages: string[] = [], effects: string[] = [];
  const runtime = new AppRuntime({ onMessages: items => { messages.splice(0, messages.length, ...items.map(item => item.text ?? "")); },
    onActivity: () => effects.push("activity"), onDoctorRequest: () => effects.push("doctor"), onPanel: () => effects.push("market"),
  }, async () => { throw new Error("No data"); }, async () => { throw new Error("No data"); }, () => { throw new Error("No model"); });
  try {
    expect(await runtime.submit('/doctor --tool search_symbols --market A --schema')).toBe("continue");
    expect(messages.join("\n")).toContain("stock_basic"); expect(messages.join("\n")).toContain("keyword"); expect(effects).toEqual([]);
  } finally { await runtime.shutdown(); }
});

test("AppRuntime installed schema stays local without opening Doctor or market data", async () => {
  const effects: string[] = [];
  const runtime = new AppRuntime({ onMessages: () => {}, onActivity: () => effects.push("activity"), onDoctorRequest: () => effects.push("doctor"),
    onPanel: () => effects.push("market") }, async () => { throw new Error("No data"); },
    async () => { throw new Error("No data"); }, () => { throw new Error("No model"); });
  try {
    expect(await runtime.submit('/doctor --tool fetch_index_rows --market A --schema --installed --endpoint index_stock_info')).toBe("continue");
    expect(effects).toEqual([]);
    expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_SETTINGS_SCHEMA_MUST_NOT_READ");
  } finally { await runtime.shutdown(); }
}, 15000);

test("actual installed schema query runs before damaged settings and writes no workspace state", async () => {
  const before = readdirSync(root);
  const command = '/doctor --tool fetch_index_rows --market A --schema --installed --endpoint index_stock_info';
  const child = Bun.spawn([process.execPath, "src/index.ts", "--json", "-c", command],
    { env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe" });
  const deadline = setTimeout(() => child.kill(), 15000);
  try {
    const [out, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(error).toBe("");
    const result = JSON.parse(out);
    expect(exit).toBe(result.ok ? 0 : 1);
    if (result.ok) {
      expect(result.data).toMatchObject({ kind: "tool-probe-schemas", scope: "installed-signatures",
        comparison: { packagedVersion: AKSHARE_INDEX_SIGNATURE_VERSION } });
      expect(typeof result.data.comparison.matchesPackaged).toBe("boolean");
    }
    else expect(result.error).toMatchObject({ code: "command_failed" });
    expect(readdirSync(root)).toEqual(before);
    expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_SETTINGS_SCHEMA_MUST_NOT_READ");
  } finally { clearTimeout(deadline); child.kill(); await child.exited; }
}, 20000);

test.each([
  { command: '/doctor --tool search_symbols --market A --schema', ok: true },
  { command: '/doctor --tool fetch_index_rows --market A --schema --endpoint index_stock_info', ok: true },
  { command: '/doctor --tool fetch_bars --market US --schema --symbol AAPL', ok: false },
])("actual one-shot schema protocol works before configuration: $command", async ({ command, ok }) => {
  const before = readdirSync(root), child = Bun.spawn([process.execPath, "src/index.ts", "--json", "-c", command],
    { env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe" });
  const deadline = setTimeout(() => child.kill(), 10000);
  try {
    const [out, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exit).toBe(ok ? 0 : 1); expect(error).toBe("");
    const result = JSON.parse(out);
    expect(result.ok).toBe(ok);
    if (ok) expect(result.data).toMatchObject({ kind: "tool-probe-schemas", scope: "static-declarations" });
    else expect(result.error.code).toBe("command_failed");
    expect(readdirSync(root)).toEqual(before); expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_SETTINGS_SCHEMA_MUST_NOT_READ");
  } finally { clearTimeout(deadline); child.kill(); await child.exited; }
}, 15000);
