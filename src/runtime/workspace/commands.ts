import { isLocalSlashCommand } from "./command-catalog.ts";
import type { AppState, UIMessage } from "../../types/ui.ts";
import type { CommandEffect, CommandResult, ParsedCommand } from "../../types/commands.ts";
import { shouldRenderCommandResultAsMessage } from "./messages.ts";

export interface RuntimeCommandInvocation {
  isSkillInvoke: boolean;
  isCompactCommand: boolean;
  skillName: string;
  localOnly: boolean;
}

export interface CommandResultRuntimeContext {
  getMessages: () => UIMessage[];
  setMessages: (messages: UIMessage[]) => void;
  emitMessages: () => void;
  emitComposerQueue: (queue: string[]) => void;
  setStatus: (status: AppState["composerStatus"]) => void;
  pushLocalCommandMessage: (text: string, role: "assistant" | "error") => void;
  syncOverviewPanel: () => void;
  resetAgent: () => void;
  openConfig: () => void;
  openDoctor: (doctor?: unknown) => void;
  openResume: () => void;
  openSession: () => void;
  openPortfolio: () => void;
  openHelp: () => void;
  openArtifact: () => void;
  syncMessagesFromAgentState: () => void;
  syncSessionPanel: () => void;
  emitLocalStorageState: () => void;
  refreshMarketPanel: () => void;
}

export function getRuntimeCommandInvocation(parsed: ParsedCommand): RuntimeCommandInvocation {
  const isSkillInvoke = parsed.command === "skill" && Boolean(parsed.positional[0]) && !["list", "info", "install"].includes(parsed.positional[0]!);
  return {
    isSkillInvoke,
    isCompactCommand: parsed.command === "compact",
    skillName: isSkillInvoke ? parsed.positional[0]! : "",
    localOnly: isPureLocalCommand(parsed),
  };
}

export function compactingStatusText(agentTurnActive: boolean): string {
  return agentTurnActive
    ? "Waiting for the active turn to settle before compacting the session context..."
    : "Compacting the current session context...";
}

export function applyCommandResult(result: CommandResult, ctx: CommandResultRuntimeContext): void {
  for (const effect of result.effects ?? []) {
    applyCommandEffect(effect, ctx);
  }
  if (!result.message) return;
  if (shouldRenderCommandResultAsMessage(result.message)) {
    ctx.pushLocalCommandMessage(result.message, result.success ? "assistant" : "error");
    ctx.setStatus(null);
    return;
  }
  ctx.setStatus({ kind: result.success ? "info" : "error", text: result.message });
}

function applyCommandEffect(effect: CommandEffect, ctx: CommandResultRuntimeContext): void {
  switch (effect.type) {
    case "clearConversation":
      ctx.setMessages([]);
      ctx.emitComposerQueue([]);
      ctx.emitMessages();
      ctx.setStatus(null);
      ctx.syncOverviewPanel();
      break;
    case "resetAgent":
      ctx.resetAgent();
      ctx.emitComposerQueue([]);
      ctx.syncOverviewPanel();
      break;
    case "openConfig":
      ctx.openConfig();
      break;
    case "openDoctor":
      ctx.openDoctor(effect.doctor);
      break;
    case "openResume":
      ctx.openResume();
      break;
    case "openSession":
      ctx.openSession();
      break;
    case "openPortfolio":
      ctx.openPortfolio();
      break;
    case "openHelp":
      ctx.openHelp();
      break;
    case "openArtifact":
      ctx.openArtifact();
      break;
    case "compactSession":
      ctx.syncMessagesFromAgentState();
      break;
    case "sessionChanged":
      ctx.syncMessagesFromAgentState();
      ctx.syncSessionPanel();
      break;
    case "portfolioChanged":
      ctx.emitLocalStorageState();
      ctx.refreshMarketPanel();
      break;
  }
}

function isPureLocalCommand(parsed: ParsedCommand): boolean {
  if (parsed.command === "config" && parsed.flags.extensions !== undefined && parsed.flags.extensions !== true && parsed.flags.extensions !== "list") return false;
  if (parsed.command === "skill" && parsed.positional[0] && !["list", "info"].includes(parsed.positional[0])) return false;
  return isLocalSlashCommand(parsed.command);
}
