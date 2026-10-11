import { expect, it } from "bun:test";
import { checkAkquantEngine, AlphaEngineError } from "../index.ts";

it("accepts only the pinned package and rule receipt as ready", async () => {
  const receipt = { status: "ready", requiredVersion: "0.3.58", version: "0.3.58", ruleVersion: "1.5.4", python: "3.14.3" } as const;
  const check = (value: unknown) => checkAkquantEngine({ python: { command: "fixture" }, runProcess: async () => JSON.stringify(value) });
  expect(await check(receipt)).toEqual(receipt);
  expect((await check({ ...receipt, version: "0.0.1" })).status).toBe("output");
  expect((await check({ ...receipt, ruleVersion: "old" })).status).toBe("output");
  expect((await check({ ...receipt, extra: "untrusted" })).status).toBe("output");
  expect((await check({ ...receipt, status: "version", version: "0.0.1" })).status).toBe("version");
});

it("preserves timeout and cancellation without leaking process diagnostics", async () => {
  const options = { python: { command: "fixture" }, runProcess: async (): Promise<string> => { throw new AlphaEngineError("timeout", "PRIVATE-DIAGNOSTIC"); } };
  expect(await checkAkquantEngine(options)).toEqual({ status: "timeout", requiredVersion: "0.3.58" });
  expect(await checkAkquantEngine(options, AbortSignal.abort())).toEqual({ status: "cancelled", requiredVersion: "0.3.58" });
});
