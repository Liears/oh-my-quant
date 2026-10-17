import { describe, expect, it } from "bun:test";
import type { AppState, UIMessage } from "../../types/ui.ts";
import type { ParsedCommand } from "../../types/commands.ts";
import {
  applyCommandResult,
  compactingStatusText,
  getRuntimeCommandInvocation,
  type CommandResultRuntimeContext,
} from "../workspace/commands.ts";

function parsed(command: string, positional: string[] = []): ParsedCommand {
  return { command, raw: `/${command}`, flags: {}, positional };
}

function commandContext() {
  const calls: string[] = [];
  const statuses: Array<AppState["composerStatus"]> = [];
  const pushed: Array<{ text: string; role: "assistant" | "error" }> = [];
  let messages: UIMessage[] = [{ role: "user", text: "hello" }];
  const ctx: CommandResultRuntimeContext = {
    getMessages: () => messages,
    setMessages: (next) => {
      messages = next;
      calls.push("setMessages");
    },
    emitMessages: () => calls.push("emitMessages"),
    emitComposerQueue: (queue) => calls.push(`emitComposerQueue:${queue.length}`),
    setStatus: (status) => {
      statuses.push(status);
      calls.push(`setStatus:${status?.kind ?? "null"}`);
    },
    pushLocalCommandMessage: (text, role) => {
      pushed.push({ text, role });
      calls.push(`push:${role}`);
    },
    syncOverviewPanel: () => calls.push("syncOverviewPanel"),
    resetAgent: () => calls.push("resetAgent"),
    openConfig: () => calls.push("openConfig"),
    openDoctor: () => calls.push("openDoctor"),
    openResume: () => calls.push("openResume"),
    openSession: () => calls.push("openSession"),
    openPortfolio: () => calls.push("openPortfolio"),
    openHelp: () => calls.push("openHelp"),
    openArtifact: () => calls.push("openArtifact"),
    syncMessagesFromAgentState: () => calls.push("syncMessagesFromAgentState"),
    syncSessionPanel: () => calls.push("syncSessionPanel"),
    emitLocalStorageState: () => calls.push("emitLocalStorageState"),
    refreshMarketPanel: () => calls.push("refreshMarketPanel"),
  };
  return { ctx, calls, statuses, pushed, get messages() { return messages; } };
}

describe("runtime command helpers", () => {
  it("classifies skill invocations separately from local skill commands", () => {
    expect(getRuntimeCommandInvocation(parsed("skill", ["install", "owner/repo"]))).toMatchObject({ isSkillInvoke: false, localOnly: true });
    expect(getRuntimeCommandInvocation(parsed("skill", ["list"]))).toEqual({
      isSkillInvoke: false,
      isCompactCommand: false,
      skillName: "",
      localOnly: true,
    });
    expect(getRuntimeCommandInvocation(parsed("skill", ["llmquant-portfolio"]))).toEqual({
      isSkillInvoke: true,
      isCompactCommand: false,
      skillName: "llmquant-portfolio",
      localOnly: false,
    });
    expect(getRuntimeCommandInvocation(parsed("compact"))).toMatchObject({
      isCompactCommand: true,
    });
  });

  it("builds compacting status text for idle and active turns", () => {
    expect(compactingStatusText(false)).toBe("Compacting the current session context...");
    expect(compactingStatusText(true)).toBe("Waiting for the active turn to settle before compacting the session context...");
  });

  it("keeps skill selection and MCP configuration local while actual skill invocations use the session", () => {
    for (const action of ["catalog", "install", "remove", "reload"]) {
      expect(getRuntimeCommandInvocation(parsed("skill", [action, "technical-analyst"]))).toMatchObject({ localOnly: true, isSkillInvoke: false });
    }
    expect(getRuntimeCommandInvocation(parsed("mcp", ["install", "web-reader"]))).toMatchObject({ localOnly: true, isSkillInvoke: false });
    expect(getRuntimeCommandInvocation(parsed("skill", ["run", "technical-analyst"]))).toMatchObject({ localOnly: false, isSkillInvoke: true, skillName: "technical-analyst" });
  });

  it("applies conversation reset effects through the runtime context", () => {
    const h = commandContext();
    applyCommandResult({ success: true, message: "", effects: [{ type: "clearConversation" }] }, h.ctx);

    expect(h.messages).toEqual([]);
    expect(h.calls).toEqual([
      "setMessages",
      "emitComposerQueue:0",
      "emitMessages",
      "setStatus:null",
      "syncOverviewPanel",
    ]);
  });

  it("routes panel and session side effects through narrow callbacks", () => {
    const h = commandContext();
    applyCommandResult({
      success: true,
      message: "changed",
      effects: [
        { type: "sessionChanged" },
        { type: "portfolioChanged" },
        { type: "openDoctor" },
        { type: "openHelp" },
      ],
    }, h.ctx);

    expect(h.calls).toEqual([
      "syncMessagesFromAgentState",
      "syncSessionPanel",
      "emitLocalStorageState",
      "refreshMarketPanel",
      "openDoctor",
      "openHelp",
      "setStatus:info",
    ]);
    expect(h.statuses.at(-1)).toEqual({ kind: "info", text: "changed" });
  });

  it("renders multiline command output as conversation messages", () => {
    const h = commandContext();
    applyCommandResult({ success: false, message: "line 1\nline 2" }, h.ctx);

    expect(h.pushed).toEqual([{ text: "line 1\nline 2", role: "error" }]);
    expect(h.statuses.at(-1)).toBeNull();
  });
});
