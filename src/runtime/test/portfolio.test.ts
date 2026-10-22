import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { editPortfolio } from "../research/portfolio.ts";
import { loadPanelPortfolio, savePanelPortfolio } from "../../storage/index.ts";
import { portfolioHandler } from "../../cli/handlers/portfolio.ts";
import { selectResearchPortfolio } from "../workspace/overview.ts";
import { activePanelPortfolioName } from "../workspace/panel-service.ts";
import { singlePortfolioToolDenial, withSinglePortfolioResearch } from "../research/active-portfolio.ts";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";

let root: string;
let previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "ohq-custom-portfolio-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR;
  else process.env.OHQUANT_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("custom portfolio workflow", () => {
  it("persists one selected group, keeps other groups, and uses the same name and members", async () => {
    const first = editPortfolio({ type: "create", name: "Core" }).groups[0]!;
    editPortfolio({ type: "add", group: first.id, code: "AAPL" });
    const second = editPortfolio({ type: "create", name: "Growth" }).groups[1]!;
    editPortfolio({ type: "add", group: second.id, code: "MSFT" });
    expect(activePanelPortfolioName(loadPanelPortfolio(), "none")).toBe("Core");
    expect((await portfolioHandler({}, ["select", second.id], {})).success).toBe(true);
    expect(loadPanelPortfolio().activeGroupId).toBe(second.id);
    expect(selectResearchPortfolio(loadPanelPortfolio()).symbols.map(entry => entry.code)).toEqual(["MSFT"]);
    expect(activePanelPortfolioName(loadPanelPortfolio(), "none")).toBe("Growth");
    expect(loadPanelPortfolio().groups).toHaveLength(2);
    editPortfolio({ type: "rename", group: second.id, name: "Research" });
    expect(activePanelPortfolioName(loadPanelPortfolio(), "none")).toBe("Research");
    editPortfolio({ type: "delete", group: second.id });
    expect(loadPanelPortfolio().activeGroupId).toBe(first.id);
    expect(activePanelPortfolioName(loadPanelPortfolio(), "none")).toBe("Core");
    expect((await portfolioHandler({}, ["select", "missing"], {})).success).toBe(false);
    expect(loadPanelPortfolio().activeGroupId).toBe(first.id);
  });

  it("blocks cross-portfolio research and injects only the selected members into the host prompt", () => {
    const first = editPortfolio({ type: "create", name: "Core" }).groups[0]!;
    editPortfolio({ type: "add", group: first.id, code: "AAPL" });
    const second = editPortfolio({ type: "create", name: "Growth" }).groups[1]!;
    editPortfolio({ type: "add", group: second.id, code: "MSFT" });
    const declared = (groupIds: string[], symbols = ["AAPL"]) => ({ action: "declare", task: { scope: { groupIds, symbols, benchmark: "SPY" } } });
    expect(singlePortfolioToolDenial("compare_portfolios", {})).toContain("disabled");
    expect(singlePortfolioToolDenial("research_task", declared([first.id, second.id]))).toContain("only");
    expect(singlePortfolioToolDenial("research_task", declared([second.id]))).toContain("selected");
    expect(singlePortfolioToolDenial("research_task", declared([first.id], ["MSFT"]))).toContain("outside");
    expect(singlePortfolioToolDenial("research_task", declared([first.id], ["aapl", "SPY"]))).toBeNull();
    const deps = withSinglePortfolioResearch(createDefaultSessionDependencies({}));
    expect(deps.tools.some(tool => tool.name === "compare_portfolios")).toBe(false);
    const ctx = { lastSymbol: null, lastMarket: null, lastStartDate: null, lastEndDate: null, recentToolState: { toolName: null, resultShape: null } };
    const prompt = deps.prompts.turn("研究当前组合", ctx);
    expect(prompt).toContain('"name":"Core"');
    expect(prompt).toContain('"symbols":["AAPL"]');
    expect(prompt).not.toContain('"name":"Growth"');
    editPortfolio({ type: "select", group: second.id });
    expect(deps.prompts.turn("继续", ctx)).toContain('"symbols":["MSFT"]');
  });

  it("creates, renames, shares symbols, removes memberships and survives reload", () => {
    const first = editPortfolio({ type: "create", name: "Core" }).groups[0]!;
    expect(loadPanelPortfolio().groups).toEqual([first]);
    editPortfolio({ type: "add", group: first.id, code: "aapl", name: "Apple" });
    const second = editPortfolio({ type: "create", name: "Growth" }).groups[1]!;
    editPortfolio({ type: "add", group: second.id, code: "AAPL" });
    editPortfolio({ type: "add", group: second.id, code: "00700.HK" });
    editPortfolio({ type: "add", group: first.id, code: "022364.OF" });
    editPortfolio({ type: "rename", group: first.id, name: "Research" });
    editPortfolio({ type: "delete", group: first.id });
    expect(loadPanelPortfolio().symbols.map(item => item.code)).toEqual(["AAPL", "00700.HK"]);
    editPortfolio({ type: "remove", group: second.id, code: "aapl" });
    expect(loadPanelPortfolio().groups[0]!.symbolCodes).toEqual(["00700.HK"]);
    editPortfolio({ type: "remove", group: second.id, code: "00700.HK" });
    expect(loadPanelPortfolio().groups).toEqual([{ ...second, symbolCodes: [] }]);
  });

  it("validates edits without changing saved preferences", () => {
    editPortfolio({ type: "create", name: "Core" });
    const before = readFileSync(join(root, "panel-portfolio.json"), "utf-8");
    expect(() => editPortfolio({ type: "create", name: "  " })).toThrow();
    expect(() => editPortfolio({ type: "create", name: "Core" })).toThrow();
    expect(() => editPortfolio({ type: "add", group: "Core", code: "../settings" })).toThrow();
    expect(() => editPortfolio({ type: "add", group: "missing", code: "AAPL" })).toThrow();
    expect(readFileSync(join(root, "panel-portfolio.json"), "utf-8")).toBe(before);
  });

  it("handles malformed preference rows without rewriting the original file", () => {
    const path = join(root, "panel-portfolio.json");
    const text = JSON.stringify({ symbols: [null, {}, { code: "AAPL", name: "Apple" }], groups: [null, { id: "a", name: "Empty", symbolCodes: null }] });
    writeFileSync(path, text);
    expect(loadPanelPortfolio().groups).toEqual([{ id: "a", name: "Empty", symbolCodes: [] }]);
    expect(loadPanelPortfolio().symbols).toHaveLength(1);
    expect(readFileSync(path, "utf-8")).toBe(text);
    savePanelPortfolio(loadPanelPortfolio());
  });

  it("supports custom portfolios from one-shot CLI without a model or legacy JSON", async () => {
    expect((await portfolioHandler({}, ["create", "Global", "research"], {})).success).toBe(true);
    expect((await portfolioHandler({}, ["add", "group-1", "BRK.B", "Berkshire"], {})).success).toBe(true);
    const listed = await portfolioHandler({}, [], {});
    expect(listed.message).toContain("Global research");
    expect(listed.message).toContain("BRK.B");
    expect((await portfolioHandler({}, ["delete", "group-1"], {})).success).toBe(true);
    expect(loadPanelPortfolio().groups).toEqual([]);
  });
});
