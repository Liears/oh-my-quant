import { spawn } from "node:child_process";
import { generateArtifact } from "../artifact/src/generator.ts";
import {
  artifactPath,
  deleteArtifact,
  listStoredSessions,
  loadArtifact,
  loadArtifactMeta,
  pruneUnrestorableArtifacts,
  saveArtifact,
  type ArtifactMeta,
} from "../storage/index.ts";
import type { CommandContext, CommandResult } from "../types/commands.ts";

function openLocalFile(path: string): void {
  const command = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "start", "", path] : [path];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
}

function artifactDisplayPath(sessionId: string): string {
  return `.ohquant/artifacts/${sessionId}.html`;
}

function storedJsonlSessions() {
  const cwd = process.cwd();
  return listStoredSessions({ cwd, scope: "all", limit: Number.MAX_SAFE_INTEGER })
    .filter((session) => session.format === "jsonl" && session.cwd === cwd);
}

/** Validate the report index and remove derived reports whose source session is gone. */
export function listRestorableArtifactReports(): ArtifactMeta[] {
  const sourceSessionIds = new Set(storedJsonlSessions().map((session) => session.id));
  return pruneUnrestorableArtifacts(sourceSessionIds).artifacts;
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

/** Restore a report selected in the Artifact panel. This is an internal UI action, not a slash command. */
export async function restoreArtifactReport(reportId: string, ctx: CommandContext): Promise<CommandResult> {
  const html = loadArtifact(reportId);
  const meta = loadArtifactMeta(reportId);
  const sourceSessionId = meta?.sourceSessionId ?? meta?.sessionId ?? reportId;
  const stored = storedJsonlSessions().find((session) => session.id === sourceSessionId);
  if (!html || !meta || !stored) {
    const removed = deleteArtifact(reportId);
    return {
      success: true,
      message: removed
        ? `Removed stale artifact ${reportId} because its source session is unavailable.`
        : `Artifact ${reportId} is no longer available.`,
    };
  }

  const outputPath = artifactPath(reportId);
  const openReport = () => (ctx.openFile ?? openLocalFile)(outputPath);
  const agentSession = ctx.agentSession;

  if (!agentSession) {
    const refreshed = generateArtifact({ sessionPath: stored.path });
    if (refreshed) {
      saveArtifact(reportId, refreshed.html, {
        title: refreshed.title,
        messageCount: refreshed.messageCount,
        sourceSessionId: stored.id,
      });
      openReport();
      return { success: true, message: `Opened artifact ${reportId} · trajectory rebuilt` };
    }
    openReport();
    return { success: true, message: `Opened artifact ${reportId} · using saved trajectory` };
  }

  let resumedMeta;
  try {
    resumedMeta = await agentSession.resumeSession(sourceSessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/session not found/i.test(message)) {
      deleteArtifact(reportId);
      return {
        success: true,
        message: `Removed stale artifact ${reportId} because its source session is unavailable.`,
      };
    }
    return {
      success: false,
      message: `Could not restore artifact ${reportId}: ${message}`,
    };
  }

  const refreshed = generateArtifact({ sessionPath: resumedMeta.path });
  if (refreshed) {
    saveArtifact(reportId, refreshed.html, {
      title: refreshed.title,
      messageCount: refreshed.messageCount,
      sourceSessionId: resumedMeta.id,
    });
  }

  const displayPath = artifactDisplayPath(reportId);
  let contextNoteFailed = false;
  if (agentSession.appendContextNote) {
    try {
      const title = refreshed?.title ?? meta?.title ?? reportId;
      const bytes = refreshed ? Buffer.byteLength(refreshed.html, "utf-8") : meta?.bytes ?? Buffer.byteLength(html, "utf-8");
      const messageCount = refreshed?.messageCount ?? meta?.messageCount ?? 0;
      await agentSession.appendContextNote("artifact_restore", buildArtifactContextNote({
        event: "restored",
        title,
        sessionId: resumedMeta.id,
        displayPath,
        bytes,
        messageCount,
      }), { title, sessionId: resumedMeta.id, path: displayPath, bytes, messageCount });
    } catch {
      contextNoteFailed = true;
    }
  }

  openReport();
  const suffix = contextNoteFailed ? " · context note failed" : " · context updated";
  const trajectory = refreshed ? " · trajectory rebuilt" : " · using saved trajectory";
  return {
    success: true,
    message: `Restored artifact ${reportId}${trajectory}${suffix}`,
    effects: [{ type: "sessionChanged" }],
  };
}

/** Generate a report after an eligible turn when Auto Artifacts is enabled. */
export async function generateCurrentSessionArtifact(
  ctx: CommandContext,
  titleOverride?: string,
): Promise<CommandResult> {
  const meta = await ctx.agentSession?.getSessionMetadata?.();
  const sessionPath = meta?.path;
  if (!sessionPath) return { success: false, message: "No active session is available for automatic artifact generation." };

  const result = generateArtifact({ sessionPath, title: titleOverride });
  if (!result) return { success: false, message: "Failed to generate artifact from session." };

  saveArtifact(result.sessionId, result.html, {
    title: result.title,
    messageCount: result.messageCount,
    sourceSessionId: result.sessionId,
  });
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
}
