import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { editPortfolio } from "../research/portfolio.ts";
import { loadPanelPortfolio, savePanelPortfolio } from "../../storage/index.ts";
import { portfolioHandler } from "../../cli/handlers/portfolio.ts";

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
