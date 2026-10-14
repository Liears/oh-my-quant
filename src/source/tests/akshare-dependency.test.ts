import { afterEach, expect, it, spyOn } from "bun:test";
import * as python from "../src/akshare-python.ts";
import { checkAkshareDependency } from "../src/akshare-dependency.ts";

const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); });

it("separates import readiness from an explicitly requested native JavaScript runtime check", async () => {
  const seen: string[][] = [];
  const run = spyOn(python, "runPython").mockImplementation(async (_script, args) => {
    seen.push(args ?? []);
    return { stdout: JSON.stringify({ status: "ready", python: "fixture", akshare: "fixture",
      ...(args?.[0] === "javascript" ? { javascript: { status: "ready" } } : {}) }), stderr: "" };
  });
  restores.push(() => run.mockRestore());
  expect(await checkAkshareDependency()).toEqual({ status: "ready", python: "fixture", akshare: "fixture" });
  expect(await checkAkshareDependency({ javascript: true })).toMatchObject({ status: "ready", javascript: { status: "ready" } });
  expect(seen).toEqual([[], ["javascript"]]);
});

it("retains import readiness while exposing only bounded native runtime diagnostics", async () => {
  const run = spyOn(python, "runPython");
  restores.push(() => run.mockRestore());
  for (const status of ["blocked", "missing-package", "unavailable"] as const) {
    run.mockResolvedValue({ stdout: JSON.stringify({ status: "ready", javascript: { status,
      ...(status === "blocked" ? { winerror: 4551 } : {}), error: "PRIVATE_ERROR_URL_AND_TOKEN" } }), stderr: "" });
    const result = await checkAkshareDependency({ javascript: true });
    expect(result).toMatchObject({ status: "ready", javascript: { status } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_ERROR_URL_AND_TOKEN");
  }
});

it("rejects malformed or missing requested runtime results and does not invent a Windows block", async () => {
  const run = spyOn(python, "runPython");
  restores.push(() => run.mockRestore());
  for (const javascript of [undefined, { status: "unknown" }, { status: "blocked", winerror: 22 }]) {
    run.mockResolvedValue({ stdout: JSON.stringify({ status: "ready", javascript }), stderr: "" });
    await expect(checkAkshareDependency({ javascript: true })).rejects.toThrow("Invalid dependency probe response");
  }
  run.mockResolvedValue({ stdout: JSON.stringify({ status: "missing-package", python: "fixture" }), stderr: "" });
  expect(await checkAkshareDependency({ javascript: true })).toEqual({ status: "missing-package", python: "fixture", akshare: undefined });
});

it("propagates cancellation rather than treating it as a missing interpreter", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled dependency check"));
  const run = spyOn(python, "runPython").mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
  restores.push(() => run.mockRestore());
  await expect(checkAkshareDependency({ javascript: true, signal: controller.signal })).rejects.toThrow("cancelled dependency check");
});
