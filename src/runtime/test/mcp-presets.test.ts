import { expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { manageMcpPresets } from "../skills/mcp-config.ts";
import { MCP_PRESETS } from "../skills/mcp-presets.ts";
import { loadMcpConfig } from "../../agent/src/pi-mcp.ts";
import { commandPreflight } from "../workspace/command-preflight.ts";
import { parseCommand } from "../../cli/registry.ts";

function fixture(run: (options: { agentDir: string; cwd: string }) => void) {
  const root = mkdtempSync(join(tmpdir(), "whyj-mcp-presets-"));
  try { run({ agentDir: join(root, "user"), cwd: join(root, "project") }); } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
}

it("lists choices and exports only selected templates without accessing credentials or creating config", () => fixture(options => {
  const listed = manageMcpPresets("list", [], options);
  expect(listed.success).toBe(true);
  expect(listed.data).toHaveProperty("catalog");
  const exported = manageMcpPresets("export", ["llmquant-data", "web-reader"], options);
  const parsed = JSON.parse(exported.message);
  expect(Object.keys(parsed.mcpServers)).toEqual(["llmquant-data", "web-reader"]);
  expect(parsed.mcpServers["llmquant-data"].env.LLMQUANT_API_KEY).toBe("${LLMQUANT_API_KEY}");
  expect(parsed.mcpServers["web-reader"].headers.Authorization).toBe("Bearer ${ZHIPU_API_KEY}");
  expect(existsSync(options.agentDir)).toBe(false);
  expect(existsSync(options.cwd)).toBe(false);
}));

it("uses Pi config APIs to install and remove selected presets without overwriting existing entries", () => fixture(options => {
  mkdirSync(options.agentDir);
  const path = join(options.agentDir, "mcp.json");
  const custom = { url: "https://example.invalid/mcp", headers: { Authorization: "fixture-private-secret" } };
  writeFileSync(path, JSON.stringify({ metadata: { keep: true }, mcpServers: { "web-reader": custom, unrelated: custom } }));
  const installed = manageMcpPresets("install", ["web-reader", "llmquant-data"], options);
  expect(installed.success).toBe(true);
  expect(installed.message).toContain("Kept existing web-reader");
  expect(JSON.stringify(installed)).not.toContain("fixture-private-secret");
  let config = JSON.parse(readFileSync(path, "utf8"));
  expect(config.metadata).toEqual({ keep: true }); expect(config.mcpServers["web-reader"]).toEqual(custom);
  expect(Object.keys(config.mcpServers)).toEqual(["web-reader", "unrelated", "llmquant-data"]);
  expect(manageMcpPresets("remove", ["llmquant-data"], options).success).toBe(true);
  config = JSON.parse(readFileSync(path, "utf8"));
  expect(config.mcpServers).toEqual({ "web-reader": custom, unrelated: custom });
  expect(config.metadata).toEqual({ keep: true });
}));

it("all templates load through Pi with Tushare disabled until its account URL is filled", () => fixture(options => {
  expect(manageMcpPresets("install", MCP_PRESETS.map(preset => preset.name), options).success).toBe(true);
  const loaded = loadMcpConfig({ ...options, projectTrusted: false });
  expect(loaded.errors).toEqual([]); expect(loaded.servers).toHaveLength(5);
  expect(loaded.servers.find(server => server.name === "tushare")?.config.enabled).toBe(false);
}));

it("edits project overrides without replacing the user config and explains inherited servers", () => fixture(options => {
  manageMcpPresets("install", ["web-reader"], options);
  const globalPath = join(options.agentDir, "mcp.json"), original = readFileSync(globalPath, "utf8");
  mkdirSync(join(options.cwd, ".pi"), { recursive: true });
  const localPath = join(options.cwd, ".pi", "mcp.json");
  writeFileSync(localPath, JSON.stringify({ mcpServers: { "web-reader": { enabled: false } } }));
  expect(manageMcpPresets("install", ["llmquant-data"], { ...options, local: true }).success).toBe(true);
  const result = manageMcpPresets("remove", ["web-reader"], { ...options, local: true });
  expect(result.success).toBe(true); expect(result.message).toContain("reveal a user-level");
  expect(readFileSync(globalPath, "utf8")).toBe(original);
  expect(Object.keys(JSON.parse(readFileSync(localPath, "utf8")).mcpServers)).toEqual(["llmquant-data"]);
}));

it("rejects invalid batches, cancelled writes and corrupt files without partial selection or credential echoes", () => fixture(options => {
  expect(manageMcpPresets("install", ["web-reader", "unknown"], options).success).toBe(false);
  expect(existsSync(options.agentDir)).toBe(false);
  expect(() => manageMcpPresets("install", ["web-reader"], { ...options, signal: AbortSignal.abort() })).toThrow();
  expect(existsSync(options.agentDir)).toBe(false);
  mkdirSync(options.agentDir);
  const path = join(options.agentDir, "mcp.json"), broken = '{"mcpServers": fixture-private-secret';
  writeFileSync(path, broken);
  const result = manageMcpPresets("install", ["web-reader"], options);
  expect(result.success).toBe(false); expect(JSON.stringify(result)).not.toContain("fixture-private-secret");
  expect(readFileSync(path, "utf8")).toBe(broken);
  expect(manageMcpPresets("export", ["web-reader"], options).success).toBe(true);
}));

it("validates MCP and skill management arguments before side effects", () => {
  for (const command of ["/mcp", "/mcp list --local", "/mcp install web-reader llmquant-data", "/mcp remove web-reader --local", "/mcp export web-reader", "/skill install llmquant-risk technical-analyst", "/skill install --all", "/skill remove llmquant-risk", "/skill catalog"]) {
    expect(commandPreflight(parseCommand(command)!)).toBeUndefined();
  }
  for (const command of ["/mcp install", "/mcp remove", "/mcp export", "/mcp info", "/mcp list extra", "/mcp install web-reader --all", "/mcp export web-reader --local", "/mcp remove ../private", "/skill install --all false", "/skill install llmquant-risk --all", "/skill install owner/repo another/repo", "/skill remove", "/skill catalog extra"]) {
    expect(commandPreflight(parseCommand(command)!)?.success).toBe(false);
  }
});
