import { expect, test } from "bun:test";
import { volumeRatio } from "../factor.ts";
import { factorEvidenceBoundary } from "../factor-evidence.ts";

test("including current volume does not force a unit ratio", () => {
  // Current 20 / mean(10, 20)=15: 4/3, despite including current volume.
  expect(volumeRatio([10, 20], 2)).toEqual([null, 4 / 3]);
  expect(volumeRatio([10, 10], 2)).toEqual([null, 1]);
  // Equality does not require every earlier volume to be identical.
  expect(volumeRatio([5, 15, 10], 3)).toEqual([null, null, 1]);
  expect(volumeRatio([0, 0], 2)).toEqual([null, null]);
  expect(factorEvidenceBoundary("volume_ratio")).toContain("Including current volume does not force the ratio to equal one");
});
