/**
 * Slash command parser and dispatcher.
 * / prefix → direct execution.  No prefix → AI Agent.
 */
import { SLASH_COMMANDS } from "./catalog.ts";
import { commandPreflight } from "../runtime/command-preflight.ts";
import { isInstalledToolProbeSchemaQuery } from "../runtime/tool-probe-schema.ts";
import { installedAkshareIndexSchemaResult } from "../runtime/installed-akshare-index-schema.ts";
import { tokenizeSlashArguments } from "./arguments.ts";
import {
  clearHandler,
  compactHandler,
  configHandler,
  doctorHandler,
  exitHandler,
  helpHandler,
  portfolioHandler,
  resumeHandler,
} from "./handlers/system.ts";
import { skillHandler } from "../skill/handler.ts";
import { artifactHandler } from "./handlers/artifact.ts";
import type { CommandContext, CommandHandler, CommandResult, ParsedCommand } from "./types.ts";

export { SLASH_COMMANDS };
export type { CommandContext, CommandResult, ParsedCommand } from "./types.ts";

const LOCAL_COMMANDS = new Set(["help", "clear", "config", "doctor", "portfolio", "resume", "compact", "skill", "artifact"]);

export function isLocalSlashCommand(command: string): boolean {
  return LOCAL_COMMANDS.has(command);
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const { tokens: parts, error } = tokenizeSlashArguments(trimmed.slice(1));
  if (parts.length === 0) return null;
  let command = parts[0]!.value;
  let colonArg = "";
  const colonIdx = command.indexOf(":");
  if (colonIdx > 0) {
    colonArg = command.slice(colonIdx + 1);
    command = command.slice(0, colonIdx);
  }
  if (command === "session") command = "resume";
  const flags: Record<string, string | number | boolean> = Object.create(null);
  let argumentError = error ?? (!command ? "Missing command name." : undefined);
  const positional: string[] = colonArg ? [colonArg] : [];
  let i = 1;
  while (i < parts.length) {
    const { value: part, quoted } = parts[i]!;
    const next = parts[i + 1];
    const hasValue = next && (next.quoted || !next.value.startsWith("--") && !/^-[A-Za-z]$/.test(next.value));
    if (!quoted && (part.startsWith("--") || /^-[A-Za-z]$/.test(part))) {
      const key = part.slice(part.startsWith("--") ? 2 : 1);
      if (Object.hasOwn(flags, key)) argumentError = `Duplicate option ${part}.`;
      if (hasValue) {
        i++; flags[key] = parts[i]!.value;
      } else flags[key] = true;
    } else {
      positional.push(part);
    }
    i++;
  }
  return { command, raw: trimmed, flags, positional, ...(argumentError ? { argumentError } : {}) };
}

const HANDLERS: Record<string, CommandHandler> = {
  config: configHandler,
  portfolio: portfolioHandler,
  compact: compactHandler,
  doctor: doctorHandler,
  resume: resumeHandler,
  skill: skillHandler,
  artifact: artifactHandler,
  help: helpHandler,
  clear: clearHandler,
};

export async function executeCommand(cmd: ParsedCommand, ctx: CommandContext = {}): Promise<CommandResult> {
  const early = commandPreflight(cmd);
  if (early) return early;
  if (isInstalledToolProbeSchemaQuery(cmd)) return installedAkshareIndexSchemaResult(cmd.flags, cmd.positional, { signal: ctx.commandSignal });
  const { command, flags, positional } = cmd;
  if (command === "exit") return exitHandler();
  const handler = HANDLERS[command];
  if (!handler) {
    return { success: false, message: `Unknown /${command}. Run /help to see available slash commands.` };
  }
  return handler(flags, positional, ctx);
}
