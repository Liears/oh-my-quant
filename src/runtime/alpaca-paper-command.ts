/** Explicit external paper service; credentials are read only on this command path. */
import { createAlpacaPaperAdapter } from "../app/alpaca-paper/index.ts";
import { cancelOrder, lookupOrder, submitOrder } from "../execution/index.ts";
import type { ExecutionTarget } from "../execution/index.ts";
import { appRoot, privateRoot, selectedIntent } from "./private-paper-files.ts";

const ACTIONS = ["account", "submit", "lookup", "cancel"] as const;
type Action = typeof ACTIONS[number];
const USAGE = "Use whyj alpaca-paper account --root ABS --account ID, or alpaca-paper submit|lookup|cancel --root ABS --account ID --intent-file ABS.json.";

function parse(args: readonly string[]): { action: Action; values: Record<string, string> } {
  const action = args[0];
  if (!ACTIONS.includes(action as Action)) throw new Error(USAGE);
  const allowed = action === "account" ? ["--root", "--account"] : ["--root", "--account", "--intent-file"];
  const values: Record<string, string> = Object.create(null);
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!key || !allowed.includes(key) || !value || value.startsWith("--") || Object.hasOwn(values, key)) throw new Error(USAGE);
    values[key] = value;
  }
  if (allowed.some(key => !values[key])) throw new Error(USAGE);
  return { action: action as Action, values };
}

export async function runAlpacaPaperCommand(args: readonly string[], signal: AbortSignal) {
  signal.throwIfAborted();
  const { action, values } = parse(args), state = appRoot();
  const root = privateRoot(values["--root"]!, state), accountRef = values["--account"]!;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(accountRef)) throw new Error("Invalid Alpaca paper account ID.");
  const keyId = process.env.ALPACA_PAPER_KEY_ID, secretKey = process.env.ALPACA_PAPER_SECRET_KEY;
  if (!keyId || !secretKey) throw new Error("Set ALPACA_PAPER_KEY_ID and ALPACA_PAPER_SECRET_KEY for the selected paper account.");
  const adapter = createAlpacaPaperAdapter({ root, accountRef, credentials: async () => ({ keyId, secretKey }) });
  if (action === "account") return { action, visibility: "private-external-paper" as const, account: await adapter.account(signal) };
  const target: ExecutionTarget = { adapterId: "alpaca-paper", accountRef, mode: "paper" };
  const intent = selectedIntent(values["--intent-file"]!, state, target);
  const outcome = action === "submit" ? await submitOrder(adapter, intent, { signal })
    : action === "lookup" ? await lookupOrder(adapter, intent, signal)
      : await cancelOrder(adapter, intent, { signal });
  return { action, visibility: "private-external-paper" as const, outcome };
}

export function alpacaPaperCommandOk(result: Awaited<ReturnType<typeof runAlpacaPaperCommand>>): boolean {
  if ("account" in result) return true;
  return result.outcome.status === "submitted" || result.outcome.status === "found"
    || result.outcome.status === "resolved" || result.outcome.status === "requested";
}
