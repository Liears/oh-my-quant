import { describe, expect, it } from "bun:test";
import { err, ok } from "./results.ts";

describe("tool result helpers", () => {
  it("creates pi text results with details", () => {
    expect(ok("hello", { count: 1 })).toEqual({
      content: [{ type: "text", text: "hello" }],
      details: { count: 1 },
    });
  });

  it("creates formatted quant errors", () => {
    const result = err("DATA_NO_CACHE", "000300.SH");
    const first = result.content[0];
    expect(first?.type).toBe("text");
    if (first?.type !== "text") throw new Error("expected text content");
    expect(first.text).toContain("No cached data for this symbol");
    expect(first.text).toContain("000300.SH");
    expect(result.details).toEqual({ error: { code: "DATA_NO_CACHE", message: first.text } });
  });
});
