import type { AgentTool } from "../agent/src/pi/index.ts";
import { SYSTEM_TOOLS } from "./bash-tool.ts";
import { AKSHARE_FUND_TOOL_REGISTRATIONS } from "./akshare-fund-tools.ts";
import { DATA_TOOLS } from "./data-tools.ts";
import { COMPUTE_TOOLS } from "./quant-tools.ts";
import { builtinToolDisplay, type BuiltinToolDomain, type ToolDisplay } from "./display.ts";

export { builtinToolDisplay } from "./display.ts";
export type { BuiltinToolDomain, DataProvider, ToolDisplay } from "./display.ts";

export interface BuiltinToolRegistration {
  tool: AgentTool;
  domain: BuiltinToolDomain;
  display: ToolDisplay;
  enabledByDefault?: boolean;
}

function defineBuiltinTools(registrations: BuiltinToolRegistration[]): BuiltinToolRegistration[] {
  const seen = new Set<string>();
  for (const registration of registrations) {
    const name = registration.tool.name;
    if (seen.has(name)) throw new Error(`Duplicate built-in tool registration: ${name}`);
    seen.add(name);
  }
  return registrations;
}

function mustTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing built-in tool implementation: ${name}`);
  return tool;
}

function mustDisplay(name: string): ToolDisplay {
  const display = builtinToolDisplay(name);
  if (!display) throw new Error(`Missing built-in tool display metadata: ${name}`);
  return display;
}

const DEFAULT_BUILTIN_TOOL_REGISTRATIONS: BuiltinToolRegistration[] = [
  { tool: mustTool(DATA_TOOLS, "fetch_bars"), domain: "data", display: mustDisplay("fetch_bars") },
  { tool: mustTool(DATA_TOOLS, "search_symbols"), domain: "data", display: mustDisplay("search_symbols") },
  { tool: mustTool(DATA_TOOLS, "fetch_snapshot"), domain: "data", display: mustDisplay("fetch_snapshot") },
  { tool: mustTool(DATA_TOOLS, "fetch_index_spot"), domain: "data", display: mustDisplay("fetch_index_spot") },
  { tool: mustTool(DATA_TOOLS, "fetch_index_info"), domain: "data", display: mustDisplay("fetch_index_info") },
  { tool: mustTool(DATA_TOOLS, "fetch_index_constituents"), domain: "data", display: mustDisplay("fetch_index_constituents") },
  { tool: mustTool(DATA_TOOLS, "fetch_index_rows"), domain: "data", display: mustDisplay("fetch_index_rows") },
  ...AKSHARE_FUND_TOOL_REGISTRATIONS.map((entry) => ({
    tool: mustTool(DATA_TOOLS, entry.name),
    domain: "data" as const,
    display: mustDisplay(entry.name),
  })),

  { tool: mustTool(COMPUTE_TOOLS, "compute_factor"), domain: "quant", display: mustDisplay("compute_factor") },
  { tool: mustTool(COMPUTE_TOOLS, "run_backtest"), domain: "quant", display: mustDisplay("run_backtest") },
  { tool: mustTool(COMPUTE_TOOLS, "check_risk"), domain: "quant", display: mustDisplay("check_risk") },
  { tool: mustTool(COMPUTE_TOOLS, "fund_dca_backtest"), domain: "quant", display: mustDisplay("fund_dca_backtest") },
  { tool: mustTool(COMPUTE_TOOLS, "score_benchmark"), domain: "quant", display: mustDisplay("score_benchmark") },
  { tool: mustTool(COMPUTE_TOOLS, "show_dashboard"), domain: "quant", display: mustDisplay("show_dashboard") },

  { tool: mustTool(SYSTEM_TOOLS, "bash"), domain: "system", display: mustDisplay("bash") },
];

export const BUILTIN_TOOL_REGISTRY = defineBuiltinTools(
  DEFAULT_BUILTIN_TOOL_REGISTRATIONS.map((registration) => ({ enabledByDefault: true, ...registration })),
);

export const BUILTIN_TOOLS: AgentTool[] = BUILTIN_TOOL_REGISTRY
  .filter((registration) => registration.enabledByDefault !== false)
  .map((registration) => registration.tool);

export function listBuiltinToolRegistrations(domain?: BuiltinToolDomain): BuiltinToolRegistration[] {
  return BUILTIN_TOOL_REGISTRY.filter((registration) => !domain || registration.domain === domain);
}

export function findBuiltinTool(name: string): AgentTool | undefined {
  return BUILTIN_TOOL_REGISTRY.find((registration) => registration.tool.name === name)?.tool;
}
