import { describe, expect, it } from "bun:test";
import {
  formatCell,
  formatParamLine,
  formatRecordPreview,
  outputLimit,
  selectPreviewFields,
  textValue,
} from "./row-preview.ts";

describe("row preview helpers", () => {
  it("formats values and clamps output limits", () => {
    expect(textValue("  value  ")).toBe("value");
    expect(formatCell(1.234500)).toBe("1.2345");
    expect(formatCell("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefg...");
    expect(formatCell("")).toBe("--");
    expect(outputLimit(undefined, 12, 100)).toBe(12);
    expect(outputLimit(200, 12, 100)).toBe(100);
    expect(outputLimit(0, 12, 100)).toBe(1);
  });

  it("selects priority fields before discovered fields", () => {
    const rows = [{ 名称: "沪深300", 代码: "000300", 最新价: 4000, extra: "x" }];
    expect(selectPreviewFields(rows, ["代码", "名称"], 3)).toEqual(["代码", "名称", "最新价"]);
  });

  it("formats deterministic record previews", () => {
    const rows = [
      { 代码: "000300", 名称: "沪深300", 最新价: 4000 },
      { 代码: "000905", 名称: "中证500", 最新价: 6000 },
    ];

    expect(formatRecordPreview(rows, ["代码", "名称"], { maxFields: 3, maxRows: 1 })).toEqual([
      "Columns    代码, 名称, 最新价",
      "01         代码=000300  名称=沪深300  最新价=4000",
    ]);
    expect(formatParamLine({ symbol: "000300", empty: "", limit: 20 })).toBe("symbol=000300  limit=20");
  });
});
