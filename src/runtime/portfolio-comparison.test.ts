import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { runPortfolioComparison, restorePortfolioComparison, formatPortfolioComparison, type PortfolioComparisonDeps, type PortfolioComparisonRequest } from "./portfolio-comparison.ts";
import { comparisonFixture } from "../quant/fixtures/portfolio-comparison.ts";
import { comparePortfolios } from "../quant/portfolio-comparison.ts";
import { loadPanelPortfolio, savePanelPortfolio, savePortfolioComparison, loadPortfolioComparison, listPortfolioComparisons } from "../storage/index.ts";
import { editPortfolio } from "./portfolio.ts";

let root: string, previous: string | undefined;
beforeEach(() => { previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-comparison-")); process.env.OHQUANT_DIR = root; });
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected test directory");
  rmSync(root, { recursive: true, force: true });
});
function setup() {
  const fixture = comparisonFixture(), data = loadPanelPortfolio();
  data.groups = fixture.groups.map(group => ({ id: group.id, name: group.name, symbolCodes: [...group.members] }));
  data.symbols = fixture.prices.map(price => ({ code: price.symbol, name: price.symbol, added: "2025-01-01" }));
  savePanelPortfolio(data);
  const request: PortfolioComparisonRequest = { groups: ["Core", "growth"], start: fixture.start, end: fixture.end, benchmark: "spy",
    baseCurrency: "USD", currencies: { aapl: "USD", MSFT: "USD", SPY: "USD" }, weighting: "buy-and-hold", missingMembers: "fail" };
  const calls: string[] = [];
  const deps: PortfolioComparisonDeps = { portfolio: loadPanelPortfolio, save: savePortfolioComparison,
    price: async (symbol, currency, start, end) => {
      calls.push(symbol); expect(currency).toBe("USD"); expect([start, end]).toEqual([fixture.start, fixture.end]);
      return structuredClone(fixture.prices.find(price => price.symbol === symbol)!);
    }, fx: async () => structuredClone(fixture.fx) };
  return { request, deps, calls, fixture };
}

test("deduplicates shared members and benchmark, saves replayable inputs, and leaves groups byte-identical", async () => {
  const { request, deps, calls } = setup(), path = join(root, "panel-portfolio.json"), before = readFileSync(path, "utf8");
  const artifact = await runPortfolioComparison(request, undefined, deps);
  expect(calls.sort()).toEqual(["AAPL", "MSFT", "SPY"]);
  expect(artifact.result.input.portfolioRevision).toBe(loadPanelPortfolio().revision!);
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(restorePortfolioComparison(artifact.id)).toEqual(artifact);
  expect(listPortfolioComparisons().items).toHaveLength(1);
  expect(formatPortfolioComparison(artifact.result)).toContain("Common valuations");
  expect(formatPortfolioComparison(artifact.result)).toContain("VaR95");
});

test("captures groups and caller inputs before async work even when preferences change", async () => {
  const { request, deps } = setup(), revision = loadPanelPortfolio().revision;
  const original = deps.price;
  deps.price = async (...args) => {
    if (args[0] === "AAPL") { editPortfolio({ type: "rename", group: "core", name: "Changed" }); request.baseCurrency = "CNY"; }
    return original(...args);
  };
  const artifact = await runPortfolioComparison(request, undefined, deps);
  expect(artifact.result.input.groups[0].name).toBe("Core");
  expect(artifact.result.input.portfolioRevision).toBe(revision!);
  expect(artifact.result.input.baseCurrency).toBe("USD");
  expect(loadPanelPortfolio().groups[0]!.name).toBe("Changed");
});

test("rejects invalid selections and missing currency before price calls", async () => {
  const { request, deps, calls } = setup();
  await expect(runPortfolioComparison({ ...request, currencies: {} }, undefined, deps)).rejects.toThrow("Specify quote currencies");
  await expect(runPortfolioComparison({ ...request, groups: ["core", "Core"] }, undefined, deps)).rejects.toThrow("two different");
  await expect(runPortfolioComparison({ ...request, weights: [{ AAPL: 1 }, undefined] }, undefined, deps)).rejects.toThrow("sum to 1");
  editPortfolio({ type: "create", name: "Empty" });
  await expect(runPortfolioComparison({ ...request, groups: ["Empty", "core"] }, undefined, deps)).rejects.toThrow("empty");
  expect(calls).toEqual([]);
  expect(listPortfolioComparisons().items).toEqual([]);
});

test("cancels all running price requests, stops queued work and never saves", async () => {
  const { request, deps } = setup(), controller = new AbortController();
  let started = 0, cancelled = 0;
  deps.price = async (_symbol, _currency, _start, _end, signal) => {
    started++;
    return new Promise((_, reject) => { signal!.addEventListener("abort", () => { cancelled++; reject(signal!.reason); }, { once: true }); });
  };
  const pending = runPortfolioComparison(request, controller.signal, deps);
  controller.abort(new Error("Cancelled comparison"));
  await expect(pending).rejects.toThrow("Cancelled comparison");
  expect(started).toBe(3); expect(cancelled).toBe(3);
  expect(listPortfolioComparisons().items).toEqual([]);
});

test("provider errors cancel siblings and FX cancellation prevents publication", async () => {
  const { request, deps } = setup();
  let siblingCancelled = false;
  deps.price = async (symbol, _currency, _start, _end, signal) => {
    if (symbol === "AAPL") throw new Error("provider failed");
    return new Promise((_, reject) => { signal!.addEventListener("abort", () => { siblingCancelled = true; reject(signal!.reason); }, { once: true }); });
  };
  await expect(runPortfolioComparison({ ...request, missingMembers: "exclude" }, undefined, deps)).rejects.toThrow("provider failed");
  expect(siblingCancelled).toBe(true);
  const second = setup(), controller = new AbortController();
  second.deps.fx = async () => { controller.abort(new Error("cancel FX")); return second.fixture.fx; };
  await expect(runPortfolioComparison(second.request, controller.signal, second.deps)).rejects.toThrow("cancel FX");
  expect(listPortfolioComparisons().items).toEqual([]);
});

test("uses a bounded pool and treats shared benchmark only once", async () => {
  const { request, deps, fixture } = setup(), data = loadPanelPortfolio();
  data.groups[0]!.symbolCodes = ["AAPL", "MSFT", "AMZN", "GOOG", "NVDA", "META"];
  savePanelPortfolio(data);
  let active = 0, maximum = 0;
  const calls: string[] = [];
  deps.price = async (symbol, currency) => {
    active++; maximum = Math.max(maximum, active); calls.push(symbol);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return { ...structuredClone(fixture.prices[0]!), symbol, currency };
  };
  request.benchmark = "AAPL";
  request.currencies = Object.fromEntries(data.groups[0]!.symbolCodes.map(symbol => [symbol, "USD"]));
  await runPortfolioComparison(request, undefined, deps);
  expect(maximum).toBe(4); expect(calls).toHaveLength(6); expect(calls.filter(symbol => symbol === "AAPL")).toHaveLength(1);
});

test("immutable IDs, traversal rejection, corrupt file preservation and arithmetic recheck", () => {
  const result = comparePortfolios(comparisonFixture()), first = savePortfolioComparison(result), second = savePortfolioComparison(result);
  expect(first.id).not.toBe(second.id);
  expect(() => loadPortfolioComparison("../settings")).toThrow("Invalid");
  const path = join(root, "benchmark", "comparisons", "portfolios", `${first.id}.json`);
  const envelope = JSON.parse(readFileSync(path, "utf8")) as { artifact: typeof first; hash: string };
  envelope.artifact.result.groups[0].totalReturn = 0.99;
  writeFileSync(path, JSON.stringify(envelope));
  expect(() => restorePortfolioComparison(first.id)).toThrow("integrity");
  expect(listPortfolioComparisons().unavailable).toHaveLength(1);
  envelope.hash = createHash("sha256").update(JSON.stringify(envelope.artifact)).digest("hex");
  writeFileSync(path, JSON.stringify(envelope));
  expect(() => restorePortfolioComparison(first.id)).toThrow("recorded inputs");
  expect(readFileSync(path, "utf8")).toBe(JSON.stringify(envelope));
});

test.each([1, 2] as const)("restores version %s without rewriting bytes and explains the actual holding method", methodVersion => {
  const result = comparePortfolios(comparisonFixture());
  if (methodVersion === 1) {
    result.methodVersion = 1;
    // Exact pre-upgrade text: do not generate the old archive using the new replay branch.
    result.assumptions.warning = "Hypothetical allocations, not account holdings. No fees, taxes, dividends or corporate-action repair. Rebalance at common valuation dates only. Annualized risk approximates irregular observation intervals; VaR is per interval, not necessarily one trading day. Daily closes across markets are not simultaneous; FX is a reference rate, not an execution quote.";
  }
  const artifact = savePortfolioComparison(result), path = join(root, "benchmark", "comparisons", "portfolios", `${artifact.id}.json`);
  const before = readFileSync(path, "utf8");
  const restored = restorePortfolioComparison(artifact.id);
  expect(restored).toEqual(artifact);
  expect(restored.result.groups[0].nav.map(point => point.value)).toEqual([1, 1.25, 1]);
  const text = formatPortfolioComparison(restored.result);
  expect(text).toContain("no rebalancing");
  expect(text).toContain("3 common valuation dates form 2 adjacent return intervals");
  expect(text).toContain("final NAV / initial NAV - 1");
  expect(text).not.toContain("Rebalance at common valuation dates only");
  expect(readFileSync(path, "utf8")).toBe(before);
  for (const change of ["warning", "version"] as const) {
    const edited = structuredClone(artifact);
    if (change === "warning") edited.result.assumptions.warning = "Incorrect substituted assumption";
    else Object.assign(edited.result, { methodVersion: 99 });
    writeFileSync(path, JSON.stringify({ artifact: edited, hash: createHash("sha256").update(JSON.stringify(edited)).digest("hex") }));
    expect(() => restorePortfolioComparison(artifact.id)).toThrow(change === "warning" ? "recorded inputs" : "integrity");
  }
});

test("stable IDs win over another group's name for both editing and comparison", async () => {
  const { request, deps } = setup(), data = loadPanelPortfolio();
  data.groups[0]!.name = "growth";
  savePanelPortfolio(data);
  editPortfolio({ type: "rename", group: "growth", name: "Second" });
  expect(loadPanelPortfolio().groups.map(group => group.name)).toEqual(["growth", "Second"]);
  const artifact = await runPortfolioComparison({ ...request, groups: ["core", "growth"] }, undefined, deps);
  expect(artifact.result.input.groups.map(group => group.name)).toEqual(["growth", "Second"]);
});
