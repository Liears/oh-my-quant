import { expect, it } from "bun:test";
import { summarizeFactor } from "./factor.ts";

it("does not invent a prior mean or percentile for the first valid factor value", () => {
  expect(summarizeFactor([null, null, 0.25])).toEqual({ last: 0.25, mean: null, percentile: null });
  expect(summarizeFactor([null, 0.5, 0.25])).toEqual({ last: 0.25, mean: 0.5, percentile: 0 });
  expect(summarizeFactor([null, null])).toEqual({ last: undefined, mean: null, percentile: null });
});
