import { expect, it } from "bun:test";
import { knownNewsPriceBasisViolations } from "./news-answer-claims.ts";

it("rejects a declared close basis unsupported by the selected price archive", () => {
  for (const text of ["收盘价非复权价。", "价格是未复权价。", "Price adjustment: unadjusted.", "We used unadjusted closes."]) {
    expect(knownNewsPriceBasisViolations(text, "provider-unspecified")).toEqual(["unsupported-news-price-adjustment"]);
    expect(knownNewsPriceBasisViolations(text, null)).toEqual(["unsupported-news-price-adjustment"]);
    expect(knownNewsPriceBasisViolations(text, "unadjusted")).toEqual([]);
    expect(knownNewsPriceBasisViolations(text, "forward-adjusted")).toEqual(["unsupported-news-price-adjustment"]);
  }
  expect(knownNewsPriceBasisViolations("价格为前复权价。", "forward-adjusted")).toEqual([]);
  expect(knownNewsPriceBasisViolations("Price basis: forward-adjusted.", "unadjusted")).toEqual(["unsupported-news-price-adjustment"]);
});

it("keeps unknown basis and explicit uncertainty separate from affirmative price claims", () => {
  for (const text of ["复权口径未知；计算使用 close。", "不能确定收盘价未复权。", "不应假定价格是未复权价。",
    "Do not assume unadjusted closes.", "Price adjustment: provider-unspecified."]) {
    expect(knownNewsPriceBasisViolations(text, "provider-unspecified")).toEqual([]);
  }
  expect(knownNewsPriceBasisViolations("不能证明因果；收盘价非复权价。", "provider-unspecified"))
    .toEqual(["unsupported-news-price-adjustment"]);
});
