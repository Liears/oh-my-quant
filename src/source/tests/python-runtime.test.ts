import { expect, test } from "bun:test";
import { runPython } from "../src/akshare-python.ts";

test("an explicit packaged Python path never falls back to a machine interpreter", async () => {
  const before = process.env.WHYJ_PYTHON;
  process.env.WHYJ_PYTHON = "whyj-missing-private-interpreter";
  try {
    await expect(runPython("print('unexpected host fallback')")).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (before === undefined) delete process.env.WHYJ_PYTHON;
    else process.env.WHYJ_PYTHON = before;
  }
});
