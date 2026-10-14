import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsonProcess } from "../process.ts";

const child = join(import.meta.dir, "fixtures/child.ts");

test("JSON transport preserves UTF-8 and does not interpret input as shell code", async () => {
  const input = JSON.stringify({ name: "合成行情", literal: "$(never-execute); `echo secret`" });
  expect(await runJsonProcess({ command: process.execPath, args: [child, "echo"], input, timeoutMs: 5000 })).toBe(input);
});

test("missing interpreter, nonzero exit and excessive output have bounded failures", async () => {
  await expect(runJsonProcess({ command: "whyj-missing-python-executable", args: [], input: "{}", timeoutMs: 1000 }))
    .rejects.toMatchObject({ code: "unavailable" });
  for (const [mode, code] of [["error", "process"], ["stdout-limit", "output"], ["stderr-limit", "output"]]) {
    const result = runJsonProcess({ command: process.execPath, args: [child, mode!], input: "{}", timeoutMs: 5000 });
    await expect(result).rejects.toMatchObject({ code });
    await expect(result).rejects.not.toThrow("private-adapter-diagnostic");
  }
});

test("deadline terminates the real child before returning", async () => {
  const dir = mkdtempSync(join(tmpdir(), "whyj-alpha-timeout-"));
  const pidFile = join(dir, "pid");
  try {
    await expect(runJsonProcess({ command: process.execPath, args: [child, "hang", pidFile], input: "{}", timeoutMs: 2000 }))
      .rejects.toMatchObject({ code: "timeout" });
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 10000);

test("active cancellation terminates the child and pre-cancellation never starts it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "whyj-alpha-cancel-"));
  const pidFile = join(dir, "pid");
  const controller = new AbortController();
  try {
    const task = runJsonProcess({ command: process.execPath, args: [child, "hang", pidFile], input: "{}", timeoutMs: 5000, signal: controller.signal });
    const observed = task.catch(error => error);
    const deadline = Date.now() + 4000;
    while (!existsSync(pidFile) && Date.now() < deadline) await Bun.sleep(10);
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    controller.abort();
    expect(await observed).toMatchObject({ code: "cancelled" });
    expect(() => process.kill(pid, 0)).toThrow();
    const absent = join(dir, "absent");
    await expect(runJsonProcess({ command: process.execPath, args: [child, "hang", absent], input: "{}", timeoutMs: 5000, signal: controller.signal }))
      .rejects.toMatchObject({ code: "cancelled" });
    expect(existsSync(absent)).toBe(false);
  } finally { controller.abort(); rmSync(dir, { recursive: true, force: true }); }
}, 10000);
