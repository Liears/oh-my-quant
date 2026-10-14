import { isDeepStrictEqual } from "node:util";
import { calculateAccountPerformance } from "./calculate.ts";
import { validateAccountRequest } from "./validation.ts";
import type { AccountHistory, AccountHistoryAdapter, AccountPerformanceRequest } from "./types.ts";

/** Explicit read-only adapter; no credential discovery, provider fallback, files or Agent publication. */
export async function readAccountPerformance(adapter: AccountHistoryAdapter, input: AccountPerformanceRequest, signal: AbortSignal) {
  signal.throwIfAborted(); validateAccountRequest(input);
  const request = structuredClone(input), adapterId = adapter.id;
  if (!adapterId || adapter.accountRef !== request.accountRef) throw new Error("Account history adapter does not match the requested account.");
  let onAbort!: () => void, history: AccountHistory;
  try {
    history = await Promise.race([
      adapter.readHistory(structuredClone(request), signal),
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error("Account history read cancelled."));
        if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } catch {
    throw new Error(signal.aborted ? "Account history read cancelled." : "Account history read failed; no account result was saved.");
  } finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
  signal.throwIfAborted();
  if (adapter.id !== adapterId || adapter.accountRef !== request.accountRef || history?.source?.adapterId !== adapterId
    || !isDeepStrictEqual(history?.request, request)) throw new Error("Account history response identity or interval changed.");
  if (history.source.observedAt > Date.now()) throw new Error("Account observation time is in the future.");
  return calculateAccountPerformance(history);
}
