import { describe, expect, it } from "bun:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncateTail } from "../src/session-runtime/harness/utils/truncate.ts";

describe("tool output truncation", () => {
  it("preserves unchanged text and reports the configured/default limits", () => {
    for (const truncate of [truncateHead, truncateTail]) {
      expect(truncate("中文 😀")).toEqual({ content: "中文 😀", truncated: false, truncatedBy: null,
        totalLines: 1, totalBytes: 11, outputLines: 1, outputBytes: 11, lastLinePartial: false,
        firstLineExceedsLimit: false, maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
    }
  });

  it("head keeps complete lines and reports an oversized first line", () => {
    expect(truncateHead("中文\nabc", { maxBytes: 5 })).toMatchObject({ content: "", outputLines: 0,
      outputBytes: 0, firstLineExceedsLimit: true, truncatedBy: "bytes" });
    expect(truncateHead("中文\nabc", { maxBytes: 6 })).toMatchObject({ content: "中文", outputBytes: 6, truncatedBy: "bytes" });
    expect(truncateHead("a\nb\nc", { maxLines: 2, maxBytes: 3 })).toMatchObject({ content: "a\nb", truncatedBy: "lines" });
  });

  it("tail preserves a terminal newline until truncation is necessary", () => {
    expect(truncateTail("a\nb\n")).toMatchObject({ content: "a\nb\n", totalLines: 2, outputLines: 2, outputBytes: 4 });
    expect(truncateTail("a\nb\n", { maxLines: 1 })).toMatchObject({ content: "b", totalLines: 2, outputLines: 1, truncatedBy: "lines" });
    expect(truncateTail("a\nb\nc", { maxLines: 2, maxBytes: 3 })).toMatchObject({ content: "b\nc", truncatedBy: "lines" });
  });

  it("tail takes only a valid UTF-8 suffix when its last line exceeds the byte limit", () => {
    expect(truncateTail("prefix\nA中😀Z", { maxBytes: 5 })).toMatchObject({ content: "😀Z", outputBytes: 5,
      outputLines: 1, lastLinePartial: true, firstLineExceedsLimit: false, truncatedBy: "bytes" });
    expect(truncateTail("prefix\nA中😀Z", { maxBytes: 4 })).toMatchObject({ content: "Z", outputBytes: 1, lastLinePartial: true });
    expect(truncateTail("prefix\n\uFEFFZ", { maxBytes: 4 })).toMatchObject({ content: "\uFEFFZ", outputBytes: 4 });
  });

  for (const text of ["", "ascii", "中文测试", "A😀𐐀Z", "x\uD800a\uDC00z", "x\uFEFFz", "e\u0301"]) {
    it(`matches an independent code-point suffix oracle for ${JSON.stringify(text)}`, () => {
      for (let limit = 0; limit <= Buffer.byteLength(text) + 1; limit++) {
        const result = truncateTail(text, { maxBytes: limit });
        let expected = text;
        if (Buffer.byteLength(text) > limit) {
          expected = "";
          for (const character of [...text.toWellFormed()].reverse()) {
            if (Buffer.byteLength(character + expected) > limit) break;
            expected = character + expected;
          }
        }
        expect(result.content).toBe(expected);
        expect(result.outputBytes).toBe(Buffer.byteLength(expected));
        expect(result.totalBytes).toBe(Buffer.byteLength(text));
        expect(result.outputBytes).toBeLessThanOrEqual(limit);
        expect(result.lastLinePartial).toBe(Buffer.byteLength(text) > limit);
      }
    });
  }

  it("respects both budgets across mixed multiline output, without splitting complete lines", () => {
    const lines = ["中文", "A😀B", "", "ending"];
    for (const truncate of [truncateHead, truncateTail]) {
      for (let maxLines = 1; maxLines <= lines.length; maxLines++) {
        for (let maxBytes = 0; maxBytes <= 26; maxBytes++) {
          const result = truncate(lines.join("\n"), { maxLines, maxBytes });
          expect(result.outputBytes).toBe(Buffer.byteLength(result.content));
          expect(result.outputBytes).toBeLessThanOrEqual(maxBytes);
          expect(result.outputLines).toBeLessThanOrEqual(maxLines);
          if (!result.lastLinePartial && result.outputLines) {
            const expected = truncate === truncateHead ? lines.slice(0, result.outputLines) : lines.slice(-result.outputLines);
            expect(result.content).toBe(expected.join("\n"));
          }
        }
      }
    }
  });
});
