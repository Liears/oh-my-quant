export interface CommandCatalogEntry {
  name: string;
  desc: string;
}

export const COMMAND_CATALOG: readonly CommandCatalogEntry[] = [
  { name: "/compact", desc: "Compact current session context" },
  { name: "/resume", desc: "Browse and restore saved sessions" },
  { name: "/portfolio", desc: "Browse and select local portfolios" },
  { name: "/config", desc: "Review and edit runtime settings" },
  { name: "/doctor", desc: "Configure and diagnose runtime" },
  { name: "/skill", desc: "Discover, inspect, and run skills" },
  { name: "/help", desc: "Browse commands and shortcuts" },
  { name: "/clear", desc: "Clear conversation and reset agent" },
  { name: "/artifact", desc: "Browse, restore, and open reports" },
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
  ];
  return lines.join("\n");
}
