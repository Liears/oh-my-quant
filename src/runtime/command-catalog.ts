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
  { name: "/skill", desc: "Discover, audit, and run skills" },
  { name: "/help", desc: "Browse commands and shortcuts" },
  { name: "/clear", desc: "Reset the current research session" },
  { name: "/artifact", desc: "Browse and restore research reports" },
  { name: "/exit", desc: "Exit WhyJ Quant" },
];

export const SLASH_COMMANDS = COMMAND_CATALOG.map((command) => command.name);

export function buildCommandHelpText(): string {
  const lines = [
    "Commands",
    ...COMMAND_CATALOG.map((command) => `  ${command.name.padEnd(10)} ${command.desc}`.trimEnd()),
    "",
    "Hotkeys",
    "  Ctrl+P     Open settings",
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
