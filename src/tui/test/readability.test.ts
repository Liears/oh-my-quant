import { expect, it } from "bun:test";
import { Buffer } from "../src/buffer.ts";
import { S } from "../src/styles.ts";

it("prints necessary muted text at the DESIGN palette color without terminal faint attributes", () => {
  const buffer = new Buffer(60, 6);
  for (const [index, style] of [S.dim, S.thinking, S.code, S.tableNote, S.chartMuted].entries()) {
    buffer.text(0, index, "研究说明 / 数据日期", style);
    const cell = buffer.cells[index * buffer.w]!;
    expect(cell.fg).toBe("#A6A6A6");
    expect(cell.dim).not.toBe(true);
  }
  expect(buffer.render()).not.toContain("\x1b[2m");
});
