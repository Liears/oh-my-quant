import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactHandler } from "../../handlers/artifact.ts";
import { generateCurrentSessionArtifact, restoreArtifactReport } from "../../../runtime/research/artifact-reports.ts";
import { artifactPath, loadArtifact, loadArtifactMeta, saveArtifact } from "../../../storage/index.ts";

const OHQ = join(process.cwd(), ".ohquant-test-artifact-command");

function writeSessionFile(sessionId: string): string {
  const dir = join(OHQ, "sessions", "--test-cwd--");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-07-11T00:00:00.000Z",
      cwd: process.cwd(),
    }),
    JSON.stringify({
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "2026-07-11T00:00:01.000Z",
      message: { role: "user", content: [{ type: "text", text: "export report for 000001.SZ" }] },
    }),
    JSON.stringify({
      type: "message",
      id: "m2",
      parentId: "m1",
      timestamp: "2026-07-11T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Report body" }],
        model: "deepseek-v4-pro",
        provider: "deepseek",
        api: "openai-completions",
        timestamp: Date.now(),
      },
    }),
  ];
  writeFileSync(path, lines.join("\n"), "utf-8");
  return path;
}

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

describe("artifactHandler", () => {
  it("distinguishes versions of the same report in text and JSON listings", async () => {
    writeSessionFile("versioned-report");
    const first = saveArtifact("versioned-report", "original", { title: "Same title" });
    const second = saveArtifact("versioned-report", "changed", { title: "Same title" });
    const result = await artifactHandler({}, [], {});
    expect(result.success).toBe(true);
    for (const meta of [first, second]) {
      expect(result.message).toContain(meta.revision!.slice(0, 8));
    }
    expect(result.data).toEqual({ reports: [second, first].map(meta => ({
      ref: `versioned-report@${meta.revision}`, title: "Same title", createdAt: meta.createdAt,
      sourceSessionId: "versioned-report", messageCount: 0, bytes: meta === first ? 8 : 7,
    })) });
  });

  it("opens the artifact selector without exposing generation options", async () => {
    const result = await artifactHandler({}, [], { openArtifact: () => {} });
    expect(result).toEqual({ success: true, message: "", effects: [{ type: "openArtifact" }] });
  });

  it("rejects all artifact subcommands and arguments", async () => {
    const result = await artifactHandler({}, ["report-id"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("does not accept subcommands or arguments");
  });

  it("records auto-generated report metadata in agent context", async () => {
    const sessionId = "artifact-command-session";
    const sessionPath = writeSessionFile(sessionId);
    const appendContextNote = mock(async (_customType: string, _content: string, _details?: unknown) => {});
    const openFile = mock(() => {});

    const result = await generateCurrentSessionArtifact({
      openFile,
      agentSession: {
        getSessionMetadata: mock(async () => ({
          id: sessionId,
          createdAt: "2026-07-11T00:00:00.000Z",
          cwd: process.cwd(),
          path: sessionPath,
        })),
        appendContextNote,
      } as any,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("context updated");
    expect(loadArtifact(sessionId)).not.toBeNull();
    expect(openFile).toHaveBeenCalled();
    expect(appendContextNote).toHaveBeenCalledTimes(1);
    expect(appendContextNote.mock.calls[0]![0]).toBe("artifact_export");
    expect(appendContextNote.mock.calls[0]![1]).toContain(`session_id: ${sessionId}`);
    expect(appendContextNote.mock.calls[0]![1]).toContain(`path: ${artifactPath(sessionId)}`);
  });

  it("restores the selected artifact session by default", async () => {
    const sessionId = "artifact-open-session";
    const sessionPath = writeSessionFile(sessionId);
    saveArtifact(sessionId, "<html><body>saved</body></html>", { title: "Saved Report", messageCount: 2 });
    const appendContextNote = mock(async (_customType: string, _content: string, _details?: unknown) => {});
    const resumeSession = mock(async (_sessionId: string) => ({
      id: sessionId,
      createdAt: "2026-07-11T00:00:00.000Z",
      cwd: process.cwd(),
      path: sessionPath,
    }));
    const openFile = mock(() => {});

    const result = await restoreArtifactReport(sessionId, {
      openFile,
      agentSession: {
        resumeSession,
        appendContextNote,
      } as any,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Restored artifact");
    expect(result.effects).toEqual([{ type: "sessionChanged" }]);
    expect(resumeSession).toHaveBeenCalledWith(sessionId);
    expect(openFile).toHaveBeenCalled();
    expect(appendContextNote).toHaveBeenCalledTimes(1);
    expect(appendContextNote.mock.calls[0]![0]).toBe("artifact_restore");
    expect(appendContextNote.mock.calls[0]![1]).toContain("Artifact session restored.");
    expect(appendContextNote.mock.calls[0]![1]).toContain(`path: ${artifactPath(sessionId)}`);
    expect(result.message).toContain("saved version");
    expect(loadArtifactMeta(sessionId)?.title).toBe("Saved Report");
  });

  it("resumes the metadata source session without overwriting the saved trajectory", async () => {
    const artifactId = "report-alias";
    const sourceSessionId = "source-session";
    saveArtifact(artifactId, "<html><body>stale trajectory</body></html>", {
      title: "Aliased Report",
      messageCount: 1,
      sourceSessionId,
    });
    const sessionPath = writeSessionFile(sourceSessionId);
    const resumeSession = mock(async (id: string) => ({
      id,
      createdAt: "2026-07-11T00:00:00.000Z",
      cwd: process.cwd(),
      path: sessionPath,
    }));
    const openFile = mock(() => {});

    const result = await restoreArtifactReport(artifactId, {
      openFile,
      agentSession: { resumeSession } as any,
    });

    expect(result.success).toBe(true);
    expect(resumeSession).toHaveBeenCalledWith(sourceSessionId);
    expect(loadArtifact(artifactId)).not.toContain("Report body");
    expect(loadArtifact(artifactId)).toContain("stale trajectory");
    expect(openFile).toHaveBeenCalledTimes(1);
    expect(loadArtifactMeta(artifactId)?.title).toBe("Aliased Report");
  });

  it("opens a stored version in one-shot mode without an agent session", async () => {
    const artifactId = "one-shot-report";
    const sourceSessionId = "one-shot-source";
    writeSessionFile(sourceSessionId);
    saveArtifact(artifactId, "<html><body>stale trajectory</body></html>", {
      title: "One Shot Report",
      messageCount: 1,
      sourceSessionId,
    });
    const openFile = mock(() => {});

    const result = await restoreArtifactReport(artifactId, { openFile });

    expect(result.success).toBe(true);
    expect(result.message).toContain("saved version");
    expect(loadArtifact(artifactId)).not.toContain("Report body");
    expect(loadArtifact(artifactId)).toContain("stale trajectory");
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it("retains an unavailable report without opening it or changing sessions", async () => {
    const artifactId = "orphan-report";
    saveArtifact(artifactId, "<html><body>orphan</body></html>", { sourceSessionId: "missing-session" });
    const openFile = mock(() => {});

    const result = await restoreArtifactReport(artifactId, {
      openFile,
      agentSession: {
        resumeSession: mock(async () => { throw new Error("Session not found"); }),
      } as any,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("retained for recovery");
    expect(openFile).not.toHaveBeenCalled();
    expect(loadArtifact(artifactId)).toContain("orphan");
    expect(loadArtifactMeta(artifactId)).not.toBeNull();
  });
});
