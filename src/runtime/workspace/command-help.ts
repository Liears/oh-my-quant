import { COMMAND_CATALOG } from "./command-catalog.ts";
import type { CommandResult, ParsedCommand } from "../../types/commands.ts";

/** Detailed usage stays separate from the small, shared completion catalog. */
const USAGE: Record<string, string[]> = {
  compact: ["/compact [focus]", "Summarize the active research session using the configured model.", "Example: /compact preserve dates, parameters and unresolved evidence", "Needs an active session; small contexts may need no compaction."],
  resume: ["/resume [sessionId]", "/resume --task", "Browse saved research sessions in the TUI; an active session is required in headless mode.", "--task reads current goals, evidence and missing criteria without calling the model."],
  portfolio: ["/portfolio", "/portfolio list", "/portfolio create NAME", "/portfolio add GROUP CODE [NAME]", "/portfolio remove GROUP CODE", "/portfolio rename GROUP NAME", "/portfolio delete GROUP", "/portfolio import [legacy name|file|index]", "Manage observation groups, not account positions. GROUP accepts an ID or quoted name.", "Example: /portfolio add Core 022364.OF Fund", "For comparisons, ask the agent for groups, dates, benchmark and currency."],
  config: ["/config", "/config --extensions list|enable|disable|reload [ID]", "/config --pi list|preview|apply [--from DIR] [--provider ID] [--model ID] [--review TOKEN]", "Configure models, market data, skills and report settings in the TUI.", "Headless mode shows settings; Pi apply requires the token from preview."],
  doctor: ["/doctor [--phase model,tools,data]", "/doctor --tool NAME --market MARKET [--provider NAME] [--endpoint NAME] [--name value ...]", "/doctor --tool NAME --market MARKET --schema [--provider NAME] [--endpoint NAME]", "/doctor --tool NAME --market MARKET --schema --installed [--provider akshare] [--endpoint NAME]", "--schema reads static endpoint parameters without settings, Python or network; explicit market is required.", "--schema --installed inspects local AKShare index signatures using the selected Python, without market requests or settings.", "Checks can contact the configured model or data source. Inspect each phase's status.", "Example: /doctor --tool fetch_bars --market US --provider financial-datasets --symbol AAPL --start 2025-01-06 --end 2025-01-17", "Tool probes inspect one endpoint response without executing the research tool."],
  skill: ["/skill [list] [--scope VALUE|--source VALUE]", "/skill catalog", "/skill info NAME", "/skill install [NAME ...]", "/skill install --all", "/skill install OWNER/REPO", "/skill remove NAME [NAME ...]", "/skill reload", "/skill run NAME [--image PATH] [instructions]", "/skill:NAME [--image PATH] [instructions]", "Install without names shows choices and downloads nothing. Select individual skills or explicitly choose --all.", "Selected skills share a cached repository. Remove unloads them from JQ while preserving source files and local edits; install NAME restores them.", "Pi loads SKILL.md and formats the model index. Follow each upstream skill for dependencies and credentials.", "--image reads one explicit local PNG/JPEG/WebP public chart (8 MiB maximum); requires an image-capable model. Pixels are not journaled."],
  mcp: ["/mcp [list] [--local]", "/mcp info NAME", "/mcp install NAME [NAME ...] [--local]", "/mcp remove NAME [NAME ...] [--local]", "/mcp export NAME [NAME ...]", "Choose presets; no default bulk installation. Install/remove use Pi's own config APIs, defaulting to its user mcp.json; --local selects .pi/mcp.json in this project.", "Existing named entries are preserved. Export prints selected templates without credentials or disk changes.", "Start Pi or run /reload in Pi to load changes; Pi owns transports, authentication and package startup. JQ does not connect. Tushare is added disabled until its account URL is filled in.", "Removing a project entry can reveal a user-level entry of the same name; use Pi to disable an inherited server."],
  help: ["/help [COMMAND]", "/COMMAND --help", "Browse research commands and shortcuts; inspect usage without running the target command.", "Example: /help portfolio"],
  clear: ["/clear", "Clear the visible conversation and reset the active agent and its queues.", "Saved research sessions and reports remain on disk. Use /resume to reopen them."],
  artifact: ["/artifact", "Browse saved reports; select one in the TUI to restore its research branch and open the HTML.", "No reports yet: enable Auto Artifacts in /config and complete a quant-analysis turn.", "Annual reports use the agent's annual_report / annual_reports tools."],
  exit: ["/exit", "Exit WhyJ Quant. Saved settings, research sessions and reports remain on disk."],
};

/** Return before business dispatch, including malformed help requests: help must never execute the target. */
export function commandHelpResult(parsed: ParsedCommand): CommandResult | undefined {
  const flag = parsed.flags.help !== undefined || parsed.flags.h !== undefined;
  if (!flag && !(parsed.command === "help" && parsed.positional.length)) return;
  if (flag && (parsed.flags.help !== undefined && parsed.flags.help !== true || parsed.flags.h !== undefined && parsed.flags.h !== true)) {
    return { success: false, message: "Help flags do not take a value. Use /COMMAND --help or /help COMMAND." };
  }
  if (!flag && (parsed.positional.length !== 1 || Object.keys(parsed.flags).length)) {
    return { success: false, message: "Use /help COMMAND to inspect one command." };
  }
  const target = flag ? parsed.command : parsed.positional[0]!.replace(/^\//, "");
  const name = target === "session" ? "resume" : target;
  const entry = COMMAND_CATALOG.find(entry => entry.name === `/${name}`);
  if (!entry) return { success: false, message: `Unknown /${name}. Run /help to see available slash commands.` };
  const usage = USAGE[name]!;
  return { success: true, message: [entry.name, entry.desc, "", ...usage].join("\n"), renderAs: "text",
    data: { ...entry, usage: [...usage] } };
}
