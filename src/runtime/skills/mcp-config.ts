import { join } from "node:path";
import { addMcpServerConfig, getAgentDir, loadMcpConfig, removeMcpServerConfig } from "../../agent/src/pi-mcp.ts";
import type { CommandResult } from "../../types/commands.ts";
import { MCP_PRESETS } from "./mcp-presets.ts";

/** Thin management entry for Pi's own mcp.json. Never connects or resolves credentials. */
export function manageMcpPresets(action: string, names: string[], options: { local?: boolean; cwd?: string; agentDir?: string; signal?: AbortSignal } = {}): CommandResult {
  options.signal?.throwIfAborted();
  if (!["list", "info", "install", "remove", "export"].includes(action)
    || (action === "list" ? names.length > 0 : action === "info" ? names.length !== 1 : names.length === 0)
    || names.some(name => !/^[A-Za-z0-9_-]+$/.test(name))) {
    return { success: false, message: "Use /mcp to choose names, then /mcp install, remove, info or export NAME." };
  }
  const selected = [...new Set(names)];
  const presets = selected.map(name => MCP_PRESETS.find(preset => preset.name === name));
  if (["install", "export", "info"].includes(action) && presets.some(preset => !preset)) {
    return { success: false, message: "Unknown MCP preset. Use /mcp to choose names; nothing was changed." };
  }
  if (action === "export") {
    const data = { mcpServers: Object.fromEntries(presets.map(preset => [preset!.name, structuredClone(preset!.config)])) };
    return { success: true, message: JSON.stringify(data, null, 2), data };
  }
  if (action === "info") {
    const preset = presets[0]!;
    return { success: true, message: `${preset.name}\n${preset.description}\n${preset.docs}\n${preset.setup}`, data: preset };
  }
  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? getAgentDir();
  const directory = options.local ? join(cwd, ".pi") : agentDir;
  const path = join(directory, "mcp.json");
  // Explicit --local lets Pi resolve project overrides, but edits only this scope.
  const loaded = loadMcpConfig({ agentDir, cwd, projectTrusted: options.local === true });
  if (loaded.errors.length) return { success: false, message: `Invalid MCP configuration: ${path}. Repair it in Pi before retrying; no entries were changed.` };
  const scoped = loaded.servers.filter(server => server.source === path || server.override === path);
  if (action === "list") {
    const catalog = MCP_PRESETS.map(preset => ({ name: preset.name, description: preset.description,
      status: scoped.some(server => server.name === preset.name) ? "configured" : "available" }));
    const configured = scoped.map(server => ({ name: server.name, enabled: server.config.enabled !== false }));
    return { success: true, data: { path, catalog, configured }, message: [`MCP configuration: ${path}`,
      ...catalog.map(entry => `${entry.name} [${entry.status}]: ${entry.description}`),
      ...configured.map(entry => `Configured: ${entry.name}${entry.enabled ? "" : " (disabled)"}`),
      "Choose /mcp install NAME [NAME ...], /mcp remove NAME [NAME ...], /mcp info NAME, or /mcp export NAME [NAME ...].",
      "Add --local to list/install/remove in this project's .pi/mcp.json. Connections and reload belong to Pi.",
    ].join("\n") };
  }
  if (action === "remove" && selected.some(name => !scoped.some(server => server.name === name))) {
    return { success: false, message: "A selected MCP is not configured in this scope. Use /mcp list (or --local); nothing was changed." };
  }
  if (action === "install" && selected.some(name => loaded.servers.some(server => server.name !== name && server.name.replaceAll("-", "_") === name.replaceAll("-", "_")))) {
    return { success: false, message: "A selected name conflicts with an existing Pi MCP namespace. Rename it in Pi first; nothing was changed." };
  }
  const messages: string[] = [];
  try {
    for (const name of selected) {
      options.signal?.throwIfAborted();
      if (action === "remove") {
        removeMcpServerConfig(path, name); messages.push(`Removed ${name} from this configuration.`);
      } else if (scoped.some(server => server.name === name)) {
        messages.push(`Kept existing ${name}; its configuration and credentials were not replaced.`);
      } else {
        const preset = MCP_PRESETS.find(entry => entry.name === name)!;
        addMcpServerConfig(path, name, structuredClone(preset.config));
        messages.push(`Configured ${name}. ${preset.setup}`);
      }
    }
  } catch {
    options.signal?.throwIfAborted();
    return { success: false, message: [...messages, `Could not update ${path}. Check file permissions and configuration in Pi.`].join("\n") };
  }
  return { success: true, message: [...messages, `Config: ${path}`,
    "Start Pi or run /reload in Pi to apply. JQ does not connect to servers; removal does not erase package caches or OAuth credentials.",
    ...(options.local && action === "remove" ? ["Removing a project entry can reveal a user-level server with the same name. Disable it in Pi if needed."] : []),
  ].join("\n") };
}
