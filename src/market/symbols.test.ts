import { describe, expect, it } from "bun:test";
import { baseCode, inferMarket, isAIndexSymbol } from "./symbols.ts";

describe("market symbol helpers", () => {
  it("normalizes exchange suffixes to the base code", () => {
    expect(baseCode("510300.SH")).toBe("510300");
    expect(baseCode("BRK.B")).toBe("BRK.B");
    expect(baseCode("AAPL")).toBe("AAPL");
  });

  it("infers the market from common symbol formats", () => {
    expect(inferMarket("510300.SH")).toBe("A");
    expect(inferMarket("000300")).toBe("A");
    expect(inferMarket("0700.HK")).toBe("HK");
    expect(inferMarket("AAPL")).toBe("US");
    expect(inferMarket("BRK.B")).toBe("US");
  });

  it("recognizes A-share and A-index symbols", () => {
    expect(isAIndexSymbol("000300.SH")).toBe(true);
    expect(isAIndexSymbol("399001.SZ")).toBe(true);
    expect(isAIndexSymbol("000300")).toBe(true);
    expect(isAIndexSymbol("000001.SZ")).toBe(false);
    expect(isAIndexSymbol("000001.OF")).toBe(false);
    expect(isAIndexSymbol("AAPL")).toBe(false);
  });
});
