/** `/artifact` opens the report browser. Report actions are handled internally by the TUI runtime. */
import type { CommandHandler } from "../types.ts";
import { listRestorableArtifactReports } from "../../runtime/artifact-reports.ts";
import { artifactReference } from "../../storage/index.ts";

export const artifactHandler: CommandHandler = async (flags, positional, ctx) => {
  if (Object.keys(flags).length > 0 || positional.length > 0) {
    return {
      success: false,
      message: "/artifact does not accept subcommands or arguments. Open /artifact and select a report.",
    };
  }

  if (ctx.openArtifact) {
    return { success: true, message: "", effects: [{ type: "openArtifact" }] };
  }

  const artifacts = listRestorableArtifactReports();
  if (artifacts.length === 0) {
    return {
      success: true,
      message: "No artifact reports yet. Enable Auto Artifacts in /config, then complete a quant-analysis turn.",
      data: { reports: [] },
    };
  }
  return {
    success: true,
    message: [
      "Artifact reports",
      ...artifacts.map((artifact, index) => `  ${index + 1}. ${artifact.title || artifact.sessionId} · ${artifact.createdAt} · ${artifact.revision?.slice(0, 8) ?? "legacy"}`),
      "Open /artifact in the interactive TUI to restore and view a report.",
    ].join("\n"),
    data: { reports: artifacts.map(artifact => ({
      ref: artifactReference(artifact), title: artifact.title, createdAt: artifact.createdAt,
      sourceSessionId: artifact.sourceSessionId ?? artifact.sessionId, messageCount: artifact.messageCount, bytes: artifact.bytes,
    })) },
  };
};
