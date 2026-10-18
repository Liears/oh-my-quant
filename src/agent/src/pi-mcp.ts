// Keep these shipped-module paths aligned with the exact Pi dependency version,
// like pi-skills.ts. Configuration editing does not load an MCP transport/session.
export { getAgentDir } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/config.js";
export { addMcpServerConfig, removeMcpServerConfig, loadMcpConfig,
  type McpServerConfig } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js";
