/**
 * /artifact slash command — generate or open session artifacts.
 *
 * /artifact                 — open the TUI artifact panel when available, otherwise generate
 * /artifact --generate      — generate from the current session
 * /artifact --open SESSION  — restore the artifact session and open its HTML report
 * /artifact --title "x"     — generate with custom title
 */
import type { CommandHandler } from "../types.ts";
import { generateArtifact } from "../../artifact/src/generator.ts";
import { artifactPath, loadArtifact, loadArtifactMeta, saveArtifact } from "../../storage/index.ts";
import { exec } from "node:child_process";

function openLocalFile(path: string): void {
  exec(`start "" "${path.replace(/"/g, '\\"')}"`);
}
function artifactDisplayPath(sessionId: string): string {
  return `.ohquant/artifacts/${sessionId}.html`;
}

function buildArtifactContextNote(input: {
  event: "exported" | "restored";
  title: string;
  sessionId: string;
  displayPath: string;
  bytes: number;
  messageCount: number;
}): string {
  return [
    input.event === "exported" ? "Artifact export completed." : "Artifact session restored.",
    `title: ${input.title}`,
    `session_id: ${input.sessionId}`,
    `path: ${input.displayPath}`,
    `html_bytes: ${input.bytes}`,
    `message_count: ${input.messageCount}`,
    "If the user refers to the exported report, artifact, or report file, use this metadata as current session context.",
  ].join("\n");
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
    const html = loadArtifact(openId);
    if (!html) return { success: false, message: `Artifact not found: ${openId}` };
    const agentSession = ctx.agentSession;
    if (!agentSession) {
      (ctx.openFile ?? openLocalFile)(artifactPath(openId));
      return { success: true, message: `Opened artifact ${openId}` };
    }
    try {
      await agentSession.resumeSession(openId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Failed to restore artifact session ${openId}: ${message}` };
    }
    const meta = loadArtifactMeta(openId);
    const displayPath = artifactDisplayPath(openId);
    let contextNoteFailed = false;
    if (agentSession.appendContextNote) {
      try {
        await agentSession.appendContextNote("artifact_restore", buildArtifactContextNote({
          event: "restored",
          title: meta?.title ?? openId,
          sessionId: openId,
          displayPath,
          bytes: meta?.bytes ?? html.length,
          messageCount: meta?.messageCount ?? 0,
        }), {
          title: meta?.title ?? openId,
          sessionId: openId,
          path: displayPath,
          bytes: meta?.bytes ?? html.length,
          messageCount: meta?.messageCount ?? 0,
        });
      } catch {
        contextNoteFailed = true;
      }
    }
    (ctx.openFile ?? openLocalFile)(artifactPath(openId));
    const suffix = contextNoteFailed ? " · context note failed" : " · context updated";
    return { success: true, message: `Restored artifact ${openId}${suffix}`, effects: [{ type: "sessionChanged" }] };
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
  const outputPath = artifactPath(result.sessionId);
  const displayPath = artifactDisplayPath(result.sessionId);
  let contextNoteFailed = false;
  if (ctx.agentSession?.appendContextNote) {
    try {
      await ctx.agentSession.appendContextNote("artifact_export", buildArtifactContextNote({
        event: "exported",
        title: result.title,
        sessionId: result.sessionId,
        displayPath,
        bytes: result.html.length,
        messageCount: result.messageCount,
      }), {
        title: result.title,
        sessionId: result.sessionId,
        path: displayPath,
        bytes: result.html.length,
        messageCount: result.messageCount,
      });
    } catch {
      contextNoteFailed = true;
    }
  }
  (ctx.openFile ?? openLocalFile)(outputPath);

  const suffix = contextNoteFailed ? " · context note failed" : " · context updated";
  return { success: true, message: `${result.title} — ${(result.html.length / 1024).toFixed(0)}KB · ${result.messageCount} msgs${suffix}` };
};
