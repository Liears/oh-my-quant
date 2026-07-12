import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactHandler } from "./artifact.ts";
import { loadArtifact, saveArtifact } from "../../storage/index.ts";

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
  it("records generated report metadata in agent context", async () => {
    const sessionId = "artifact-command-session";
    const sessionPath = writeSessionFile(sessionId);
    const appendContextNote = mock(async (_customType: string, _content: string, _details?: unknown) => {});
    const openFile = mock(() => {});

    const result = await artifactHandler({ generate: true }, [], {
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
    expect(appendContextNote.mock.calls[0]![1]).toContain(`path: .ohquant/artifacts/${sessionId}.html`);
  });

  it("restores the selected artifact session by default", async () => {
    const sessionId = "artifact-open-session";
    saveArtifact(sessionId, "<html><body>saved</body></html>", { title: "Saved Report", messageCount: 2 });
    const appendContextNote = mock(async (_customType: string, _content: string, _details?: unknown) => {});
    const resumeSession = mock(async (_sessionId: string) => ({
      id: sessionId,
      createdAt: "2026-07-11T00:00:00.000Z",
      cwd: process.cwd(),
      path: writeSessionFile(sessionId),
    }));
    const openFile = mock(() => {});

    const result = await artifactHandler({ open: sessionId }, [], {
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
    expect(appendContextNote.mock.calls[0]![1]).toContain(`path: .ohquant/artifacts/${sessionId}.html`);
  });
});
