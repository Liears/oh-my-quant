import { COMMAND_CATALOG } from "./command-catalog.ts";
import type { CommandResult, ParsedCommand } from "../types/commands.ts";

/** Detailed usage stays separate from the small, shared completion catalog. */
const USAGE: Record<string, string[]> = {
  compact: ["/compact [focus]", "Summarize the active research session using the configured model.", "Example: /compact preserve dates, parameters and unresolved evidence", "Needs an active session; small contexts may need no compaction."],
  resume: ["/resume [sessionId]", "/resume --task", "Browse saved research sessions in the TUI; an active session is required in headless mode.", "--task reads current goals, evidence and missing criteria without calling the model."],
  portfolio: ["/portfolio", "/portfolio list", "/portfolio create NAME", "/portfolio add GROUP CODE [NAME]", "/portfolio remove GROUP CODE", "/portfolio rename GROUP NAME", "/portfolio delete GROUP", "/portfolio import [legacy name|file|index]", "Manage observation groups, not account positions. GROUP accepts an ID or quoted name.", "Example: /portfolio add Core 022364.OF Fund", "For comparisons, ask the agent for groups, dates, benchmark and currency."],
  config: ["/config", "/config --extensions list|enable|disable|reload [ID]", "/config --pi list|preview|apply [--from DIR] [--provider ID] [--model ID] [--review TOKEN]", "Configure models, market data, skills and report settings in the TUI.", "Headless mode shows settings; Pi apply requires the token from preview."],
  doctor: ["/doctor [--phase model,tools,data]", "/doctor --tool NAME --market MARKET [--provider NAME] [--endpoint NAME] [--name value ...]", "/doctor --tool NAME --market MARKET --schema [--provider NAME] [--endpoint NAME]", "/doctor --tool NAME --market MARKET --schema --installed [--provider akshare] [--endpoint NAME]", "--schema reads static endpoint parameters without settings, Python or network; explicit market is required.", "--schema --installed inspects local AKShare index signatures using the selected Python, without market requests or settings.", "Checks can contact the configured model or data source. Inspect each phase's status.", "Example: /doctor --tool fetch_bars --market US --provider financial-datasets --symbol AAPL --start 2025-01-06 --end 2025-01-17", "Tool probes inspect one endpoint response without executing the research tool."],
  skill: ["/skill [list] [--scope VALUE|--source VALUE]", "/skill info NAME [--check] [--check-network]", "/skill audit macro-regime-detector --record PATH", "/skill audit macro-regime-detector --json REPORT.json --markdown REPORT.md", "/skill audit position-sizer --json REPORT.json --markdown REPORT.md", "/skill install OWNER/REPO", "/skill run NAME [instructions]", "/skill:NAME [instructions]", "Discovery, dependency checks and invocation are separate states.", "--check inspects declared Python versions and reviewed LLMQuant, breadth, technical, position-sizing, market-calendar or macro files without executing workflows.", "--check-network probes curated breadth CSV or macro ETF inputs.", "Audit checks selected report consistency without running a skill; position receipts omit private values and paths.", "Install uses the network; run uses the active research agent and the skill's capabilities."],
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
