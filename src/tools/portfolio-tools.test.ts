import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Check } from "typebox/value";
import { listPortfoliosTool, editPortfolioTool, comparePortfoliosTool, portfolioComparisonsTool } from "./portfolio-tools.ts";
import { listBuiltinToolCapabilities, findBuiltinTool } from "./registry.ts";
import { loadPanelPortfolio, saveBars, readSettings } from "../storage/index.ts";
import { comparisonFixture } from "../quant/fixtures/portfolio-comparison.ts";
import { inspectToolReadiness } from "../runtime/tool-readiness.ts";
import { toolProbeChoices, probeToolEndpoint } from "../runtime/tool-probe.ts";
import type { PortfolioComparisonArtifact } from "../types/portfolio-comparison.ts";
import { injectTurnContext, isQuantAnalysisRequest } from "../agent/src/context.ts";

let root: string, previous: string | undefined;
beforeEach(() => { previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-portfolio-tools-")); process.env.OHQUANT_DIR = root; });
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected test directory");
  rmSync(root, { recursive: true, force: true });
});
test("registered tools edit with exact revisions and expose before/after without account fields", async () => {
  for (const tool of [listPortfoliosTool, editPortfolioTool, comparePortfoliosTool, portfolioComparisonsTool]) expect(findBuiltinTool(tool.name) === tool).toBe(true);
  const before = (await listPortfoliosTool.execute("list", {})).details as ReturnType<typeof loadPanelPortfolio>;
  const added = await editPortfolioTool.execute("create", { expected_revision: before.revision!, edit: { type: "create", name: "Core" } });
  expect(added.details).toMatchObject({ before: { groups: [] }, after: { groups: [{ id: "group-1", name: "Core" }] } });
  const saved = readFileSync(join(root, "panel-portfolio.json"), "utf8");
  await expect(editPortfolioTool.execute("stale", { expected_revision: before.revision!, edit: { type: "delete", group: "group-1" } })).rejects.toThrow("changed");
  expect(readFileSync(join(root, "panel-portfolio.json"), "utf8")).toBe(saved);
  expect(Check(editPortfolioTool.parameters, { expected_revision: "missing", edit: { type: "add", group: "group-1", code: "AAPL", shares: 20 } })).toBe(false);
  await expect(editPortfolioTool.execute("cancel", { expected_revision: loadPanelPortfolio().revision!, edit: { type: "delete", group: "group-1" } }, AbortSignal.abort())).rejects.toThrow();
  expect(readFileSync(join(root, "panel-portfolio.json"), "utf8")).toBe(saved);
});
test("actual tool chain creates groups, reads archived source data, compares, saves and reopens", async () => {
  const edit = async (change: Parameters<typeof editPortfolioTool.execute>[1]["edit"]) => editPortfolioTool.execute("edit", { expected_revision: loadPanelPortfolio().revision!, edit: change });
  await edit({ type: "create", name: "Core" }); await edit({ type: "create", name: "Growth" });
  await edit({ type: "add", group: "Core", code: "AAPL" }); await edit({ type: "add", group: "Core", code: "MSFT" });
  await edit({ type: "add", group: "Growth", code: "MSFT" });
  const fixture = comparisonFixture();
  for (const price of fixture.prices) await saveBars(price.symbol, "financial-datasets", price.points.map(point => ({ date: point.date,
    open: point.price, high: point.price, low: point.price, close: point.price, volume: 1, amount: point.price })), fixture.start, fixture.end);
  const before = readFileSync(join(root, "panel-portfolio.json"), "utf8");
  const result = await comparePortfoliosTool.execute("compare", { group_a: "Core", group_b: "Growth", start: fixture.start, end: fixture.end,
    benchmark: "SPY", base_currency: "USD", currencies: { AAPL: "USD", MSFT: "USD", SPY: "USD" }, weighting: "rebalance" });
  const artifact = result.details as PortfolioComparisonArtifact;
  expect(artifact.result.groups[0].totalReturn).toBeCloseTo(0.5625, 12);
  expect(artifact.result.input.prices.every(price => price.origin === "cache" && !!price.dataset)).toBe(true);
  expect(readFileSync(join(root, "panel-portfolio.json"), "utf8")).toBe(before);
  const history = await portfolioComparisonsTool.execute("history", {});
  expect(history.details).toMatchObject({ items: [{ id: artifact.id }], unavailable: [] });
  expect((await portfolioComparisonsTool.execute("restore", { id: artifact.id })).details).toEqual(artifact);
});
test("comparison prerequisites expose price/NAV/FX endpoints without treating one as overall proof", async () => {
  const manifest = listBuiltinToolCapabilities().find(tool => tool.name === "compare_portfolios")!;
  expect(manifest.requirements.effects).not.toContain("portfolio-preferences");
  expect(toolProbeChoices("compare_portfolios", "US").map(choice => choice.endpoint)).toContain("ecb-fx");
  expect(toolProbeChoices("compare_portfolios", "Fund").find(choice => choice.provider === "akshare")!.endpoint).toBe("fund_open_fund_info_em");
  const settings = readSettings();
  expect(inspectToolReadiness(settings, { market: "US" }, {}, [manifest])[0]!.status).toBe("unverified");
  const request = { tool: "compare_portfolios", market: "US" as const, provider: "frankfurter" as const, endpoint: "ecb-fx",
    params: { base: "CNY", quote: "USD", start: "2025-01-01", end: "2025-01-03" } };
  const result = await probeToolEndpoint(settings, request, { processEnv: {}, adapters: { fx: async () => ({ baseCurrency: "CNY", source: "fixture", observedAt: "fixture",
    points: [{ currency: "USD", date: "2025-01-02", rate: 7 }] }) } });
  expect(result.status).toBe("ready"); expect(result.scope).toBe("endpoint-response"); expect(result.rowCount).toBe(1);
  expect((await probeToolEndpoint(settings, { ...request, params: { ...request.params, quote: "CNY" } })).status).toBe("invalid-input");
});

test("comparison prompts use portfolio metrics and qualify for the existing report workflow", () => {
  for (const input of ["对比我的两个组合", "Compare Core and Growth portfolios"]) {
    expect(isQuantAnalysisRequest(input)).toBe(true);
    const prompt = injectTurnContext(input, { lastSymbol: null, lastMarket: null, lastStartDate: null, lastEndDate: null,
      recentToolState: { toolName: null, resultShape: null } });
    expect(prompt).toContain("<!-- portfolio comparison workflow -->");
    expect(prompt).not.toContain("call compute_factor");
    expect(prompt).toContain("do not infer currencies");
  }
});
