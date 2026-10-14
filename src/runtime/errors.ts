export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Never display raw I/O/parser errors near credential editors. */
export function settingsSaveError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === "ESTORAGECONFLICT") return "Settings changed. Reopen /config; draft not saved.";
  if (code === "ELOCKED") return "Settings busy. Retry Save; draft not saved.";
  if (code === "ESTORAGEFORMAT") return "Settings invalid. Repair settings.json; draft not saved.";
  return "Could not save settings. Check file permissions and retry.";
}

export function formatSlashRuntimeError(command: string, err: unknown): string {
  const message = errorText(err);
  if (/^Session not found:/i.test(message)) {
    const sessionId = message.split(":").slice(1).join(":").trim();
    return sessionId
      ? `Could not find session "${sessionId}". Run /resume to see saved sessions, then choose one of them.`
      : "Could not find that session. Run /resume to see saved sessions, then choose one of them.";
  }
  if (/Agent harness not initialized/i.test(message)) {
    return `/${command} needs an active agent session. Send any AI message first, then try again.`;
  }
  if (/Nothing to compact/i.test(message)) {
    return "Nothing to compact. The current session context is already small enough.";
  }
  return message;
}

export function formatAgentError(prefix: string, message: string): string {
  const hint = agentErrorHint(message);
  return hint ? `${prefix}: ${message}\nHint: ${hint}` : `${prefix}: ${message}`;
}

export function agentStatusText(message: string): string {
  if (agentErrorHint(message)) return "Agent request failed. See the message above for the cause and next step.";
  return "Agent request failed. Check the conversation error above, then retry.";
}

export function providerStopReasonText(stopReason: unknown): string {
  if (stopReason === "aborted") return "The agent response was interrupted before it finished.";
  if (stopReason === "error") return "The provider ended the response with an error.";
  return `The provider ended the response unexpectedly (${String(stopReason || "unknown")}).`;
}

function agentErrorHint(message: string): string | null {
  const text = message.toLowerCase();
  if (/\bconnection error\b/i.test(message)) {
    return "Network connection to the agent provider failed. The client may already have retried automatically; if it still fails, check your network/proxy settings and send the message again.";
  }
  if (
    /\b(econnrefused|econnreset|etimedout|enotfound|socket hang up|fetch failed)\b/i.test(message)
    || /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(message)
  ) {
    return "Agent API endpoint is unreachable. Check the local API service/port, proxy settings, and the configured base URL.";
  }
  if (/\b(401|403|unauthorized|forbidden|invalid api key|missing api key|missing model credentials)\b/i.test(message)) {
    return "Open /config → Model and check the selected provider's API key or Provider setup, then run Save & Verify.";
  }
  if (/\b(404|model not found|not_found)\b/i.test(message)) {
    return "Open /config → Model and check the exact model ID. In Connection details, confirm the base URL and protocol match the service, then run Save & Verify.";
  }
  if (/\b(429|rate limit|too many requests)\b/i.test(message)) {
    return "The provider is rate limiting requests. Wait briefly or switch to another configured model/provider.";
  }
  if (/\b(500|502|503|504|bad gateway|service unavailable|gateway timeout)\b/i.test(message)) {
    return "The provider returned a server-side error. Retry later or switch the Agent API endpoint/provider.";
  }
  if (text.includes("api") && (text.includes("port") || text.includes("endpoint") || text.includes("base url"))) {
    return "Verify the Agent API base URL, port, and provider configuration in /config.";
  }
  return null;
}
