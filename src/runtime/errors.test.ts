import { describe, expect, it } from "bun:test";
import { agentStatusText, errorText, formatAgentError, formatSlashRuntimeError, providerStopReasonText } from "./errors.ts";

describe("runtime error formatting", () => {
  it("maps slash runtime errors to actionable text", () => {
    expect(formatSlashRuntimeError("resume", new Error("Session not found: abc123")))
      .toBe('Could not find session "abc123". Run /resume to see saved sessions, then choose one of them.');
    expect(formatSlashRuntimeError("compact", new Error("Nothing to compact")))
      .toBe("Nothing to compact. The current session context is already small enough.");
  });

  it("adds provider hints for agent endpoint failures", () => {
    const message = "fetch failed: connect ECONNREFUSED 127.0.0.1:11434";
    expect(formatAgentError("Agent", message)).toContain("Hint: Agent API endpoint is unreachable.");
    expect(agentStatusText(message)).toBe("Agent request failed. See the message above for the cause and next step.");
  });

  it("formats provider stop reasons and unknown errors", () => {
    expect(providerStopReasonText("aborted")).toBe("The agent response was interrupted before it finished.");
    expect(providerStopReasonText("weird")).toBe("The provider ended the response unexpectedly (weird).");
    expect(errorText("plain error")).toBe("plain error");
  });

  it("directs authentication and model failures to the shared connection editor", () => {
    for (const message of ["401 Unauthorized", "Missing model credentials", "404 model not found"]) {
      const formatted = formatAgentError("Agent", message);
      expect(formatted).toContain("/config → Model");
      expect(formatted).toContain("Save & Verify");
      expect(formatted).not.toContain("WHYJ_QUANT_API_KEY");
      expect(formatted).not.toContain("automatically");
    }
  });
});
