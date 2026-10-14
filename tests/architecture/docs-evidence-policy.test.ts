import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { isOptionalPrivateEvidence } from "../../docs/blog/evidence-path.ts";

const root = resolve(import.meta.dir, "../..");
test("only repository-local private output receipts may be absent from a clone", () => {
  expect(isOptionalPrivateEvidence(root, join(root, "output", "historical.json"))).toBe(true);
  expect(isOptionalPrivateEvidence(root, join(root, "output", "playwright", "receipt.png"))).toBe(true);
  for (const path of ["docs/assets/demo.png", "docs/blog/images/01-harness.svg", "src/source/index.ts", "tests/app/startup.test.ts", "output-private/receipt.json", "output/../docs/assets/demo.png", "../output/receipt.json"]) {
    expect(isOptionalPrivateEvidence(root, resolve(root, path))).toBe(false);
  }
  expect(isOptionalPrivateEvidence(root, root)).toBe(false);
});
