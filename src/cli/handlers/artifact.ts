/**
 * /artifact slash command — generate or open session artifacts.
 *
 * /artifact                 — open the TUI artifact panel when available, otherwise generate
 * /artifact --generate      — generate from the current session
 * /artifact --open SESSION  — open an existing artifact by session id
 * /artifact --title "x"     — generate with custom title
 */
import type { CommandHandler } from "../types.ts";
import { generateArtifact } from "../../artifact/src/generator.ts";
import { artifactPath, loadArtifact, saveArtifact } from "../../storage/index.ts";
import { exec } from "node:child_process";

function openLocalFile(path: string): void {
  exec(`start "" "${path.replace(/"/g, '\\"')}"`);
}

function requestedOpenId(flags: Record<string, string | number | boolean>, positional: string[]): string | undefined {
  if (typeof flags.open === "string") return flags.open;
  if (positional[0] === "open" && positional[1]) return positional[1];
  return undefined;
}

function requestedGenerate(flags: Record<string, string | number | boolean>, positional: string[]): boolean {
  return flags.generate === true || flags.g === true || positional[0] === "generate";
}

export const artifactHandler: CommandHandler = async (flags, positional, ctx) => {
  const openId = requestedOpenId(flags, positional);
  if (openId) {
    if (!loadArtifact(openId)) return { success: false, message: `Artifact not found: ${openId}` };
    openLocalFile(artifactPath(openId));
    return { success: true, message: `Opened artifact ${openId}` };
  }

  if (ctx.openArtifact && !requestedGenerate(flags, positional)) {
    return { success: true, message: "", effects: [{ type: "openArtifact" }] };
  }

  const meta = await ctx.agentSession?.getSessionMetadata?.();
  const sessionPath = meta?.path;
  if (!sessionPath) return { success: false, message: "No active session. Start a conversation first, then use /artifact." };

  const title = typeof flags.title === "string" ? flags.title : undefined;
  const result = generateArtifact({ sessionPath, title });
  if (!result) return { success: false, message: "Failed to generate artifact from session." };

  saveArtifact(result.sessionId, result.html, { title: result.title, messageCount: result.messageCount });
  openLocalFile(artifactPath(result.sessionId));

  return { success: true, message: `${result.title} — ${(result.html.length / 1024).toFixed(0)}KB · ${result.messageCount} msgs` };
};