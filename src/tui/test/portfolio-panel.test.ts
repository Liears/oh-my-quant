import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PanelController } from "../src/panel.ts";
import { Buffer } from "../src/buffer.ts";
import { loadPanelPortfolio } from "../../storage/index.ts";

let root: string;
let previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "ohq-portfolio-ui-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR;
  else process.env.OHQUANT_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

it("edits a portfolio with Enter/arrow/Esc and persists through reopening", () => {
  const panel = new PanelController();
  const key = (name: string, input = "") => panel.handleKey(input, { name });
  panel.open("portfolio");
  const buf = new Buffer(80, 24);
  panel.render(buf);
  expect(buf.toPlain().join("\n")).toContain("Create portfolio");
  key("return");
  key("", "跨市场组合");
  expect(key("return")).toEqual({ refreshPanel: true });
  expect(loadPanelPortfolio().groups[0]!.name).toBe("跨市场组合");
  key("return");
  key("", "022364.OF 科技基金");
  expect(key("return")).toEqual({ refreshPanel: true });
  expect(loadPanelPortfolio().symbols[0]).toMatchObject({ code: "022364.OF", name: "科技基金" });
  key("escape");
  panel.close();
  panel.open("portfolio");
  key("down");
  key("return");
  key("down"); key("down");
  expect(key("return")).toEqual({ refreshPanel: true });
  expect(loadPanelPortfolio().groups[0]!.symbolCodes).toEqual([]);
  key("return"); // Delete confirmation.
  key("escape"); // Cancel preserves the empty group.
  expect(loadPanelPortfolio().groups).toHaveLength(1);
  key("return"); key("return");
  expect(loadPanelPortfolio().groups).toEqual([]);
});
