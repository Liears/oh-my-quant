/** Opt-in private paper Agent terminal; every mutation is reviewed by the human host. */
import { createInterface } from "node:readline/promises";
import { createPrivatePaperAgent } from "../app/paper-execution/agent-session.ts";
import type { PaperReviewRequest, ReviewPaperOrder } from "../app/paper-execution/agent-tools.ts";

export interface PaperAgentTerminal {
  question(prompt: string): Promise<string>;
  write(text: string): void;
  close?(): void;
}

function standardTerminal(): PaperAgentTerminal {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => rl.close());
  return { question: prompt => rl.question(prompt), write: text => process.stdout.write(text + "\n"), close: () => rl.close() };
}

function parse(args: readonly string[]): { root: string; accountRef: string } {
  if (args[0] !== "agent" || args.length !== 5) throw new Error("Use whyj paper agent --root ABS --account ID. Interactive only; select an existing private paper account.");
  const flags = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!key || !["--root", "--account"].includes(key) || !value || value.startsWith("--") || flags.has(key))
      throw new Error("Use whyj paper agent --root ABS --account ID. Unknown, repeated or missing options are not accepted.");
    flags.set(key, value);
  }
  if (!flags.get("--root") || !flags.get("--account")) throw new Error("Paper Agent requires a private root and account ID.");
  return { root: flags.get("--root")!, accountRef: flags.get("--account")! };
}

function reviewText(request: PaperReviewRequest): string {
  const { intent } = request.prepared;
  return [
    `Paper ${request.action} review · account ${intent.target.accountRef} · ${intent.clientOrderId}`,
    `${intent.side.toUpperCase()} ${intent.quantity} ${intent.instrument.symbol} @ ${intent.limitPrice} ${intent.instrument.currency} (${intent.instrument.venue}, GTC limit)`,
    `Limit-price valuation cap ${intent.maxOrderNotional} ${intent.instrument.currency}; intent SHA-256 ${request.prepared.intentHash}`,
    request.action === "submit" ? `Paper account snapshot: ${JSON.stringify(request.account.balances)}; positions: ${JSON.stringify(request.account.positions)}`
      : `Current paper order: ${request.order?.status ?? "unavailable"}, filled ${request.order?.filledQuantity ?? "unknown"}`,
    "The paper service does not fill orders automatically.",
  ].join("\n");
}

export function reviewedByTerminal(terminal: PaperAgentTerminal): ReviewPaperOrder {
  return async (request, signal) => {
    signal.throwIfAborted();
    terminal.write(reviewText(request));
    const phrase = `approve ${request.action} ${request.prepared.intent.clientOrderId} ${request.prepared.intentHash.slice(0, 12)}`;
    let answer: string;
    try { answer = await terminal.question(`Type '${phrase}' to continue; anything else declines: `); }
    catch { return null; }
    signal.throwIfAborted();
    if (answer.trim() !== phrase) return null;
    return { action: request.action, intentHash: request.prepared.intentHash, expiresAt: Date.now() + 30_000 };
  };
}

function assistantText(messages: readonly { role: string; content?: unknown }[]): string {
  const final = [...messages].reverse().find(message => message.role === "assistant");
  if (!final || !Array.isArray(final.content)) return "No assistant text was returned. Inspect the private session before retrying an uncertain order.";
  const text = final.content.filter((block): block is { type: "text"; text: string } =>
    !!block && typeof block === "object" && block.type === "text" && typeof block.text === "string")
    .map(block => block.text).join("\n").trim();
  return text || "No assistant text was returned. Inspect the private session before retrying an uncertain order.";
}

export async function runPaperAgentCommand(args: readonly string[], suppliedTerminal?: PaperAgentTerminal): Promise<void> {
  const { root, accountRef } = parse(args);
  const terminal = suppliedTerminal ?? standardTerminal();
  let session: ReturnType<typeof createPrivatePaperAgent>;
  try { session = createPrivatePaperAgent({ root, accountRef, review: reviewedByTerminal(terminal) }); }
  catch (error) { terminal.close?.(); throw error; }
  const agent = session.agent;
  const lifetime = new AbortController();
  terminal.write(`Private paper Agent ready for ${accountRef}. This private session sends paper account/order context to the configured model provider. Orders are simulated; submit/cancel require the exact review phrase. /exit closes this private session.`);
  try {
    for (;;) {
      let line: string;
      try { line = await terminal.question("paper> "); } catch { break; }
      const input = line.trim();
      if (input === "/exit") break;
      if (!input) continue;
      const before = agent.state.messages.length;
      try {
        await agent.prompt(input, { signal: lifetime.signal });
        terminal.write(assistantText(agent.state.messages.slice(before)));
      } catch (error) {
        terminal.write(`Private paper Agent request failed: ${error instanceof Error ? error.message : "unknown error"}. Inspect the private ledger before repeating any uncertain order.`);
      }
    }
  } finally {
    lifetime.abort(); agent.abort();
    try { await agent.waitForIdle(); } finally { terminal.close?.(); }
  }
}
