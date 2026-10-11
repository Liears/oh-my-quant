import { expect, it } from "bun:test";
import { Compile } from "typebox/compile";
import { listBuiltinToolCapabilities, inspectToolReadiness, capabilityInputSummary } from "./tool-readiness.ts";
import { BUILTIN_TOOLS, listBuiltinToolRegistrations } from "../tools/registry.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";
import type { DataReadiness } from "../types/data-readiness.ts";

const sample: DataReadiness = { source: "financial-datasets", market: "US", symbol: "AAPL", start: "2025-01-06", end: "2025-01-17",
  status: "ready", detail: "1 valid row", action: "Sample only", credentialSource: "config", rowCount: 1, asOfDate: "2025-01-06",
  observedAt: "2026-09-14T00:00:00.000Z", durationMs: 10, capability: "daily-bars" };

it("projects the exact executable schema and display with mandatory requirements for every registered tool", () => {
  const manifest = listBuiltinToolCapabilities();
  expect(manifest.filter(tool => tool.enabled).map(tool => tool.name)).toEqual(BUILTIN_TOOLS.map(tool => tool.name));
  expect(new Set(manifest.map(tool => tool.name)).size).toBe(manifest.length);
  for (const [index, registration] of listBuiltinToolRegistrations().entries()) {
    const projected = manifest[index]!;
    expect(projected.description).toBe(registration.tool.description);
    expect(projected.label).toBe(registration.display.label);
    expect(JSON.stringify(projected.parameters)).toBe(JSON.stringify(registration.tool.parameters));
    expect(projected.requirements.routes.length).toBeGreaterThan(0);
    expect(projected.requirements.limitations.length).toBeGreaterThan(0);
  }
  const search = manifest.find(tool => tool.name === "search_symbols")!;
  expect(search.requirements.routes).toMatchObject([{ provider: "tushare", markets: ["A"], endpoints: ["stock_basic"] }]);
  expect(capabilityInputSummary(search)).toContain("keyword");
  const original = BUILTIN_TOOLS.find(tool => tool.name === search.name)!;
  const validator = Compile(original.parameters);
  expect(validator.Check({ keyword: "平安" })).toBe(true); expect(validator.Check({})).toBe(false);
  search.requirements.routes[0]!.permission = "caller-mutation";
  expect(listBuiltinToolCapabilities().find(tool => tool.name === search.name)!.requirements.routes[0]!.permission).not.toBe("caller-mutation");
  const archive = manifest.find(tool => tool.name === "fetch_bars_archive")!;
  expect(archive.requirements).toMatchObject({ capability: "archived-bars", routes: [{ provider: "local" }], effects: ["local-read"] });
  const archiveValidator = Compile(BUILTIN_TOOLS.find(tool => tool.name === archive.name)!.parameters);
  expect(archiveValidator.Check({ symbol: "AAPL", observed_before: "2025-01-08T00:00:00.000Z" })).toBe(true);
  expect(archiveValidator.Check({ symbol: "AAPL" })).toBe(false);
  const analysis = manifest.find(tool => tool.name === "analyze_archived_bars")!;
  expect(analysis.requirements).toMatchObject({ capability: "archived-analysis", routes: [{ provider: "local" }], effects: ["local-read"] });
  expect(analysis.parameters.type).toBe("object");
  const analysisValidator = Compile(BUILTIN_TOOLS.find(tool => tool.name === analysis.name)!.parameters);
  const common = { symbol: "AAPL", market: "US", start: "2025-01-01", end: "2025-03-21", observed_before: "2025-03-22T00:00:00.000Z" };
  expect(analysisValidator.Check({ ...common, analysis: "factor", factor: "momentum" })).toBe(true);
  expect(analysisValidator.Check({ ...common, analysis: "factor" })).toBe(true); // Mode-dependent requirement is checked by the tool.
  expect(analysisValidator.Check({ ...common, analysis: "backtest" })).toBe(true);
  expect(analysisValidator.Check({ ...common, analysis: "risk" })).toBe(true);
  expect(analysisValidator.Check({ ...common, analysis: "risk", observed_before: undefined })).toBe(false);
  for (const name of ["compute_factor", "run_backtest", "check_risk"]) {
    const registered = manifest.find(tool => tool.name === name)!;
    const validator = Compile(BUILTIN_TOOLS.find(tool => tool.name === name)!.parameters);
    expect(validator.Check({ ...common, ...(name === "compute_factor" ? { factor: "momentum" } : {}) })).toBe(true);
    expect(registered.requirements.limitations).toContain("Optional observed_before");
    expect(registered.requirements.effects).toContain("local-read");
  }
});

it("keeps archive-only bars callable with no provider credentials or Python while leaving live bars blocked", () => {
  const cfg = structuredClone(DEFAULT_SETTINGS); cfg.env = {};
  const entries = inspectToolReadiness(cfg, { market: "US", python: { status: "missing-python" } }, {});
  expect(entries.find(tool => tool.name === "fetch_bars")!.status).toBe("blocked");
  const archive = entries.find(tool => tool.name === "fetch_bars_archive")!;
  expect(archive.status).toBe("local");
  expect(archive.routes).toMatchObject([{ provider: "local", status: "local" }]);
  expect(archive.limitations).toContain("not that a matching, intact prior response exists");
  const analysis = entries.find(tool => tool.name === "analyze_archived_bars")!;
  expect(analysis.status).toBe("local");
  expect(analysis.routes).toMatchObject([{ provider: "local", status: "local" }]);
  expect(analysis.limitations).toContain("does not prove archive existence");
});

it("does not promote fund/search permissions or tool execution after one US price sample", () => {
  const cfg = structuredClone(DEFAULT_SETTINGS);
  cfg.env = { WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "saved-secret" };
  const entries = inspectToolReadiness(cfg, { market: "US", data: sample, python: { status: "missing-python" } }, {});
  const bars = entries.find(tool => tool.name === "fetch_bars")!;
  expect(bars.status).toBe("sample-verified"); expect(bars.sample?.symbol).toBe("AAPL");
  expect(entries.find(tool => tool.name === "run_backtest")!.limitations).toContain("sufficient observations");
  expect(entries.find(tool => tool.name === "search_symbols")!.status).toBe("blocked");
  expect(entries.filter(tool => tool.name.startsWith("akshare_fund_")).every(tool => tool.status === "blocked" && !tool.sample)).toBe(true);
  expect(entries.find(tool => tool.name === "bash")!.routes[0]!.reason).toContain("not executed");
  expect(JSON.stringify(entries)).not.toContain("saved-secret");
  const fund = inspectToolReadiness(cfg, { market: "Fund", python: { status: "missing-package" } }, {});
  expect(fund.find(tool => tool.name === "akshare_fund_fee")!.routes[0]!).toMatchObject({ status: "blocked", reason: "missing-package" });
});

it("distinguishes missing dependencies, independent endpoint permissions and an available alternative route", () => {
  const cfg = structuredClone(DEFAULT_SETTINGS); cfg.env.WHYJ_QUANT_TUSHARE_TOKEN = "saved-tushare-key";
  const entries = inspectToolReadiness(cfg, { market: "A", python: { status: "missing-python" } }, {});
  const spot = entries.find(tool => tool.name === "fetch_index_spot")!;
  expect(spot.status).toBe("unverified");
  expect(spot.routes).toMatchObject([{ provider: "sina", status: "unverified" }, { provider: "akshare", status: "blocked", reason: "missing-python" }]);
  expect(entries.find(tool => tool.name === "fetch_index_info")!.status).toBe("blocked");
  const readyPython = inspectToolReadiness(cfg, { market: "Fund", python: { status: "ready", python: "fixture", akshare: "fixture" } }, {});
  expect(readyPython.find(tool => tool.name === "akshare_fund_fund_fee_em")!.status).toBe("unverified");
  const known = { ...sample, source: "tushare" as const, market: "A" as const, symbol: "000001.SZ" };
  const checked = inspectToolReadiness(cfg, { market: "A", data: known }, {});
  expect(checked.find(tool => tool.name === "fetch_bars")!.status).toBe("sample-verified");
  expect(checked.find(tool => tool.name === "search_symbols")!.status).toBe("unverified");
});

it("uses saved credentials before environment values and never retains a failed or cancelled sample as verified", () => {
  const cfg = structuredClone(DEFAULT_SETTINGS);
  const env = { WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "env-secret" };
  for (const status of ["permission-denied", "empty", "timeout", "cancelled"] as const) {
    const entries = inspectToolReadiness(cfg, { market: "US", data: { ...sample, status, rowCount: 0, asOfDate: null } }, env);
    expect(entries.some(tool => tool.status === "sample-verified" || tool.sample)).toBe(false);
    expect(entries.find(tool => tool.name === "fetch_bars")!.routes.find(route => route.provider === "financial-datasets")!.status).toBe(status === "cancelled" ? "unverified" : "blocked");
  }
  cfg.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = "";
  const entries = inspectToolReadiness(cfg, { market: "US", data: sample }, env);
  expect(entries.find(tool => tool.name === "fetch_bars")!.status).toBe("unverified");
});

it("exposes zero-key US/HK daily routes while keeping Python and endpoint evidence scoped", () => {
  const cfg = structuredClone(DEFAULT_SETTINGS); cfg.env = {};
  for (const market of ["US", "HK"] as const) {
    const unknown = inspectToolReadiness(cfg, { market }, {});
    expect(unknown.find(tool => tool.name === "fetch_bars")!.routes.find(route => route.provider === "akshare"))
      .toMatchObject({ status: "unverified", reason: "Python / akshare not checked" });
    expect(unknown.find(tool => tool.name === "research_news")!.status).toBe("unverified");
    const missing = inspectToolReadiness(cfg, { market, python: { status: "missing-python" } }, {});
    expect(missing.find(tool => tool.name === "fetch_bars")!.status).toBe("blocked");
    expect(missing.find(tool => tool.name === "research_news")!.status).toBe("blocked");
    const checked = inspectToolReadiness(cfg, { market, python: { status: "ready" }, data: { ...sample,
      source: "akshare", market, symbol: market === "US" ? "AAPL" : "00700.HK", credentialSource: "not-required" } }, {});
    expect(checked.find(tool => tool.name === "fetch_bars")!.status).toBe("sample-verified");
    expect(checked.find(tool => tool.name === "research_news")!.status).toBe("unverified");
  }
});
