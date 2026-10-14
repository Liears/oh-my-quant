import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { readChartImage } from "../models/chart-image-input.ts";
import { MAX_CHART_IMAGE_BYTES } from "../../agent/src/chart-images.ts";
import { executeCommand, parseCommand } from "../../cli/registry.ts";
import { commandPreflight } from "../workspace/command-preflight.ts";
import type { CommandAgentSession } from "../../types/commands.ts";

let root: string;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "whyj-chart-input-")); writeFileSync(join(root, "weekly chart.png"), Buffer.from(png, "base64")); });
afterEach(() => { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected chart fixture root"); rmSync(root, { recursive: true, force: true }); });

it("reads explicitly selected chart bytes and rejects URLs, directories, missing, empty and oversized files", async () => {
  expect(await readChartImage(join(root, "weekly chart.png"))).toEqual({ type: "image", mimeType: "image/png", data: png });
  const empty = join(root, "empty.png"), large = join(root, "large.png"); writeFileSync(empty, ""); writeFileSync(large, "x"); truncateSync(large, MAX_CHART_IMAGE_BYTES + 1);
  for (const path of ["", "https://example.org/chart.png", root, join(root, "missing.png"), empty, large]) await expect(readChartImage(path)).rejects.toThrow();
  writeFileSync(empty, "not an image"); await expect(readChartImage(empty)).rejects.toThrow("PNG");
  await expect(readChartImage(join(root, "weekly chart.png"), AbortSignal.abort())).rejects.toThrow();
});

it("forwards quoted chart paths, instructions and cancellation from both existing skill entry styles", async () => {
  const calls: unknown[][] = [], controller = new AbortController();
  const session = { getSkills: async () => [{ name: "technical-analyst", description: "Fixture", filePath: "fixture", scope: "project", source: "pi" }],
    skill: async (...args: unknown[]) => { calls.push(args); } } as unknown as CommandAgentSession;
  for (const input of [`/skill:technical-analyst --image "${join(root, "weekly chart.png")}" 分析周线`,
    `/skill run technical-analyst --image "${join(root, "weekly chart.png")}" 分析周线`,
    `/skill trigger --name technical-analyst --image "${join(root, "weekly chart.png")}"`]) {
    expect((await executeCommand(parseCommand(input)!, { agentSession: session, commandSignal: controller.signal })).success).toBe(true);
  }
  expect(calls).toHaveLength(3); expect(calls[0]![0]).toBe("technical-analyst"); expect(calls[0]![1]).toBe("分析周线");
  expect(calls[0]![2]).toEqual({ images: [{ type: "image", mimeType: "image/png", data: png }], signal: controller.signal });
  const result = await executeCommand(parseCommand(`/skill run missing --image "${join(root, "missing.png")}"`)!, { agentSession: session });
  expect(result.message).toContain("Unknown skill"); expect(calls).toHaveLength(3);
});

it("rejects invalid image options before any file, settings or model side effects", async () => {
  const forbidden = () => { throw new Error("Unexpected side effect"); };
  for (const input of ['/skill:technical-analyst --image', '/skill run technical-analyst --image ""',
    '/skill run technical-analyst --image a --image b', '/skill info technical-analyst --image a', '/skill list --image a',
    '/skill install owner/repo --image a', '/skill audit position-sizer --image a']) {
    expect(commandPreflight(parseCommand(input)!)?.success).toBe(false);
    expect((await executeCommand(parseCommand(input)!, { agentSession: { getSkills: forbidden } as never })).success).toBe(false);
  }
  const help = await executeCommand(parseCommand('/skill:technical-analyst --image missing.png --help')!, { agentSession: { getSkills: forbidden } as never });
  expect(help.success).toBe(true);
});
