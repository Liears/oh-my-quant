import { DEFAULT_TERMINAL_OPERATION_KEYBINDINGS } from "../../types/config.ts";

export interface CommandCatalogEntry {
  name: string;
  desc: string;
}

export const COMMAND_CATALOG: readonly CommandCatalogEntry[] = [
  { name: "/compact", desc: "Compact research session context" },
  { name: "/resume", desc: "Resume saved research sessions" },
  { name: "/portfolio", desc: "Manage observation portfolios" },
  { name: "/config", desc: "Configure models and research data" },
  { name: "/doctor", desc: "Check model and market data readiness" },
  { name: "/skill", desc: "Download, load, and run skills" },
  { name: "/mcp", desc: "Choose and manage MCP presets for Pi" },
  { name: "/help", desc: "Browse commands and shortcuts" },
  { name: "/clear", desc: "Reset the current research session" },
  { name: "/artifact", desc: "Browse and restore research reports" },
  { name: "/exit", desc: "Exit WhyJ Quant" },
];

export const SLASH_COMMANDS = COMMAND_CATALOG.map((command) => command.name);

const LOCAL_COMMANDS = new Set(["help", "clear", "config", "doctor", "portfolio", "resume", "compact", "skill", "mcp", "artifact"]);

export function isLocalSlashCommand(command: string): boolean {
  return LOCAL_COMMANDS.has(command);
}

export function buildCommandHelpText(): string {
  const lines = [
    "Commands",
    ...COMMAND_CATALOG.map((command) => `  ${command.name.padEnd(10)} ${command.desc}`.trimEnd()),
    "",
    "Hotkeys",
    "  Ctrl+P     Open settings",
    `  ${DEFAULT_TERMINAL_OPERATION_KEYBINDINGS.interruptResearch[0]}     Stop current research request (default; keeps saved evidence)`,
    `  ${DEFAULT_TERMINAL_OPERATION_KEYBINDINGS.retryFailedQuotes[0]}     Retry failed Overview symbols (default)`,
    "  Enter      Submit input",
    "  Tab        Accept slash suggestion",
    "  Esc        Clear input / close panel",
    "  Ctrl+C     Clear input or quit",
    "  PgUp/Down  Scroll conversation",
    "  Shift+PgUp/PgDown  Scroll overview",
    "",
    "No / prefix → AI analysis",
    "Command usage → /help COMMAND or /COMMAND --help",
    "Current research task → /resume --task",
    "Compare portfolios → ask the agent with groups, dates, benchmark and currency",
    "Plugin management → /config --extensions list",
    "Pi connection import → /config --pi list",
  ];
  return lines.join("\n");
}
