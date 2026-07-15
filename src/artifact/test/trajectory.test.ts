import { describe, expect, it } from "bun:test";
import { buildTrajectoryFromSession } from "../src/trajectory.ts";
import { renderTrajectoryDocument } from "../src/trajectory-renderer.ts";

describe("artifact trajectory restoration", () => {
  it("pairs persisted tool calls and results by their real call id", () => {
    const trajectory = buildTrajectoryFromSession([
      {
        type: "message",
        timestamp: "2026-07-13T00:00:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call-risk", name: "check_risk", arguments: { symbol: "AAA" } }],
        },
      },
      {
        type: "message",
        timestamp: "2026-07-13T00:00:01.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-risk",
          toolName: "check_risk",
          content: [{ type: "text", text: "risk failed" }],
          isError: true,
        },
      },
    ], "session-1", "run-1");

    expect(trajectory.events.map((event) => event.tool?.callId)).toEqual(["call-risk", "call-risk"]);
    expect(trajectory.events[1]?.status).toBe("error");
    expect(trajectory.summary.failedToolCallCount).toBe(1);
    expect(trajectory.summary.successToolCallCount).toBe(0);
  });

  it("restores complete turn input, bash command, result, and assistant output", () => {
    const longResult = `Composite Score: 53.0%\n${"detail ".repeat(120)}`;
    const trajectory = buildTrajectoryFromSession([
      {
        type: "message",
        timestamp: "2026-07-13T01:00:00.000Z",
        message: { role: "displayUser", content: [{ type: "text", text: "hidden injected context" }], displayText: "/artifact" },
      },
      {
        type: "message",
        timestamp: "2026-07-13T01:00:01.000Z",
        message: { role: "assistant", content: [{ type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "bun test src/artifact" } }] },
      },
      {
        type: "message",
        timestamp: "2026-07-13T01:00:02.000Z",
        message: { role: "toolResult", toolCallId: "bash-1", toolName: "bash", content: [{ type: "text", text: longResult }], isError: false },
      },
      {
        type: "message",
        timestamp: "2026-07-13T01:00:03.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "Final result: risk is controlled." }] },
      },
    ], "session-2", "run-2");

    expect(trajectory.events.map((event) => event.turnIndex)).toEqual([1, 1, 1, 1, 1]);
    expect(trajectory.events[0]?.summary).toBe("/artifact");
    expect(trajectory.events[1]?.type).toBe("model_input");
    expect(trajectory.events[1]?.raw).toBe("hidden injected context");
    const toolResult = trajectory.events.find((event) => event.type === "tool_result");
    expect(String(toolResult?.tool?.resultPreview).length).toBeGreaterThan(500);
    expect(trajectory.summary.capturedContentBlockCount).toBe(4);
    expect(trajectory.summary.sourceContentBlockCount).toBe(4);

    const html = renderTrajectoryDocument(trajectory);
    expect(html).toContain("TURN 01");
    expect(html).toContain("traj-user-command");
    expect(html).toContain("BASH COMMAND");
    expect(html).toContain("bun test src/artifact");
    expect(html).toContain("FULL ARGUMENTS");
    expect(html).toContain("FULL RETURN");
    expect(html).toContain('data-call-id="bash-1" open');
    expect(html).toContain("traj-key-result");
    expect(html).toContain("Final result: risk is controlled.");
    expect(html).toContain("MODEL INPUT");
    expect(html).toContain("4/4");
  });

  it("captures thinking, source metadata, compaction boundaries, and empty results", () => {
    const trajectory = buildTrajectoryFromSession([
      {
        type: "message", id: "user-1", parentId: null, timestamp: "2026-07-13T02:00:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "analyze AAA" }] },
      },
      {
        type: "message", id: "assistant-1", parentId: "user-1", timestamp: "2026-07-13T02:00:01.000Z",
        message: {
          role: "assistant", model: "quant-model", provider: "test", stopReason: "toolUse",
          usage: { totalTokens: 42 },
          content: [
            { type: "thinking", thinking: "check price first" },
            { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "whyj tool run quote AAA" } },
          ],
        },
      },
      {
        type: "message", id: "result-1", parentId: "assistant-1", timestamp: "2026-07-13T02:00:02.000Z",
        message: { role: "toolResult", toolCallId: "call-1", content: [], isError: false },
      },
      {
        type: "compaction", id: "compact-1", parentId: "result-1", timestamp: "2026-07-13T02:00:03.000Z",
        summary: "Kept the market-data result.",
      },
    ], "session-3", "run-3");

    expect(trajectory.events.map((event) => event.type)).toEqual([
      "user_request", "assistant_thinking", "tool_call", "tool_result", "context_compaction",
    ]);
    expect(trajectory.summary.thinkingCount).toBe(1);
    expect(trajectory.summary.compactionCount).toBe(1);
    expect(trajectory.summary.sourceEntryCount).toBe(4);
    expect(trajectory.summary.capturedContentBlockCount).toBe(3);
    expect(trajectory.summary.sourceContentBlockCount).toBe(3);
    expect(trajectory.events[1]?.source).toEqual(expect.objectContaining({
      entryId: "assistant-1", parentId: "user-1", blockIndex: 0, model: "quant-model",
    }));

    const html = renderTrajectoryDocument(trajectory);
    expect(html).toContain("ASSISTANT THINKING");
    expect(html).toContain("CONTEXT COMPACTION");
    expect(html).toContain("(empty tool result)");
    expect(html).toContain("assistant-1");
  });

  it("renders complete Tool and Skill call chains across persisted schema variants", () => {
    const trajectory = buildTrajectoryFromSession([
      {
        type: "message", timestamp: "2026-07-13T03:00:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "run the quant workflow" }] },
      },
      {
        type: "message", timestamp: "2026-07-13T03:00:01.000Z",
        message: {
          role: "assistant",
          content: [{
            type: "tool_call", id: "skill-1", name: "Skill",
            arguments: { skill: "whyj-quant", prompt: "<skill name=\"whyj-quant\">analyze AAA</skill>" },
          }],
        },
      },
      {
        type: "message", timestamp: "2026-07-13T03:00:02.000Z",
        message: {
          role: "tool", tool_call_id: "skill-1", name: "Skill",
          content: [
            { type: "text", text: "Skill loaded successfully" },
            { type: "resource", uri: "skill://whyj-quant/SKILL.md", bytes: 4096 },
          ],
          details: { status: "loaded", resourceCount: 1 },
        },
      },
      {
        type: "message", timestamp: "2026-07-13T03:00:03.000Z",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "quote-1", name: "fetch_quote", input: { symbol: "AAA", venue: "XNAS" } }],
        },
      },
      {
        type: "message", timestamp: "2026-07-13T03:00:04.000Z",
        message: {
          role: "tool_result", toolCallId: "quote-1", toolName: "fetch_quote",
          content: [{ type: "text", text: "price: 123.45" }],
          details: { latencyMs: 17, cache: false },
        },
      },
    ], "session-4", "run-4");

    const skillCall = trajectory.events.find((event) => event.type === "tool_call" && event.tool?.callId === "skill-1");
    const skillResult = trajectory.events.find((event) => event.type === "tool_result" && event.tool?.callId === "skill-1");
    expect(skillCall?.tool).toEqual(expect.objectContaining({ name: "whyj-quant", kind: "skill" }));
    expect(skillResult?.tool).toEqual(expect.objectContaining({ name: "whyj-quant", kind: "skill" }));
    expect(String(skillResult?.tool?.resultPreview)).toContain("skill://whyj-quant/SKILL.md");
    expect(skillResult?.tool?.resultDetails).toEqual({ status: "loaded", resourceCount: 1 });
    expect(trajectory.summary.skillCallCount).toBe(1);
    expect(trajectory.summary.skillsUsed).toEqual(["whyj-quant"]);
    expect(trajectory.summary.toolsUsed).toEqual(["fetch_quote"]);

    const html = renderTrajectoryDocument(trajectory);
    expect(html).toContain("TURN 01");
    expect(html).toContain("2</b> calls");
    expect(html).toContain("2</b> returns");
    expect(html).toContain("SKILL CALL");
    expect(html).toContain("SKILL RESULT");
    expect(html).toContain("whyj-quant");
    expect(html).toContain("skill://whyj-quant/SKILL.md");
    expect(html).toContain("RETURN METADATA");
    expect(html).toContain("latencyMs");
    expect(html).toContain('data-call-id="quote-1" open');
  });
});
