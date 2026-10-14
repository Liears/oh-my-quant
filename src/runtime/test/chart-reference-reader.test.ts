import { expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createChartReferenceReader, type ChartReferenceRead } from "../dev/chart/chart-reference-reader.ts";
import { bashTool } from "../../tools/bash-tool.ts";

test("valid production read variants delegate with a bounded workdir and preserve partial-read provenance", async () => {
  const path = resolve("output", "pinned", "framework.md"), cwd = resolve("output"), calls: ChartReferenceRead[] = [];
  const execute = mock(async (_id: string, _args: Parameters<typeof bashTool.execute>[1]) => ({ content: [{ type: "text" as const, text: "framework" }], details: {} }));
  const reader = createChartReferenceReader([path], cwd, calls, { ...bashTool, execute });
  await reader.execute("full", { command: `Get-Content -LiteralPath '${path}' -Raw -Encoding utf8` });
  const bounded = `Get-Content "${path.replaceAll("\\", "/")}" -Encoding utf8 | Select-Object -First 60`;
  await reader.execute("partial", { command: bounded, workdir: cwd, timeout_ms: 1000 });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]![1]).toEqual({ command: `Get-Content -LiteralPath '${path}' -Raw -Encoding utf8`, workdir: cwd, timeout_ms: 30000 });
  expect(calls).toEqual([
    { resource: "framework.md", allowed: true, fullRead: true, succeeded: true },
    { resource: "framework.md", allowed: true, fullRead: false, succeeded: true },
  ]);
});

test("rejects unpinned reads, chained commands, substitutions and resource changes before shell execution", async () => {
  const path = resolve("output", "framework.md"), cwd = resolve("output"), calls: ChartReferenceRead[] = [];
  const execute = mock(async () => ({ content: [], details: {} }));
  const reader = createChartReferenceReader([path], cwd, calls, { ...bashTool, execute });
  const command = `Get-Content '${path}' -Raw`;
  for (const args of [
    { command: `Get-Content '${resolve(".ohquant", "settings.json")}'` },
    { command: command + "; Get-ChildItem" },
    { command: command + " | Set-Content output.txt" },
    { command: command + " | Select-Object -First 999999" },
    { command: `Get-Content "$env:OHQUANT_DIR/settings.json"` },
    { command, workdir: resolve("..") },
    { command, timeout_ms: Infinity },
    { command, timeout_ms: 30001 },
  ]) await expect(reader.execute("reject", args)).rejects.toThrow("Only exact Get-Content");
  expect(execute).not.toHaveBeenCalled();
  expect(calls.every(call => !call.allowed && !call.succeeded)).toBe(true);
  expect(() => createChartReferenceReader(["output/$env:TEMP.md"], cwd, [])).toThrow("path quoting");
});

test("a failed production execution is not recorded as a successful reference read", async () => {
  const path = resolve("output", "framework.md"), calls: ChartReferenceRead[] = [];
  const reader = createChartReferenceReader([path], process.cwd(), calls, { ...bashTool, execute: async () => { throw new Error("read failed"); } });
  await expect(reader.execute("fail", { command: `Get-Content '${path}'` })).rejects.toThrow("read failed");
  expect(calls).toEqual([{ resource: "framework.md", allowed: true, fullRead: true, succeeded: false }]);
});

test.skipIf(process.platform !== "win32" || Boolean(process.env.WHYJ_SHELL))("production PowerShell reads an entire UTF-8 guidance file", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "whyj-chart-reference-"));
  try {
    const path = join(cwd, "framework.md"), calls: ChartReferenceRead[] = [];
    writeFileSync(path, "图表参考\n" + "line\n".repeat(80) + "END-OF-REFERENCE", "utf8");
    const reader = createChartReferenceReader([path], cwd, calls);
    const result = await reader.execute("real-shell", { command: `Get-Content -LiteralPath '${path}' -Raw -Encoding utf8` });
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("END-OF-REFERENCE") })]));
    expect(calls[0]).toMatchObject({ allowed: true, fullRead: true, succeeded: true });
  } finally {
    if (!resolve(cwd).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected fixture root");
    rmSync(cwd, { recursive: true, force: true });
  }
}, 15000);
