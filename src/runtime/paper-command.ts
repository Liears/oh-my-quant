/** Explicit local paper-account operation. No model, Agent tool, market cache, or broker connection. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createLocalPaperService } from "../app/paper-execution/index.ts";
import { parseDecimal } from "../app/paper-execution/decimal.ts";
import { cancelOrder, lookupOrder, submitOrder } from "../execution/index.ts";
import type { ExecutionTarget } from "../execution/index.ts";
import { appRoot, privateRoot, selectedIntent } from "./private-paper-files.ts";

const ACTIONS = ["init", "account", "submit", "lookup", "cancel"] as const;
type Action = typeof ACTIONS[number];
const USAGE = "Use whyj paper init --root ABS --account ID --currency USD --cash DECIMAL, or paper account|submit|lookup|cancel --root ABS --account ID [--intent-file ABS.json].";

function parse(args: readonly string[]): { action: Action; values: Record<string, string> } {
  const action = args[0];
  if (!ACTIONS.includes(action as Action)) throw new Error(USAGE);
  const allowed = action === "init" ? ["--root", "--account", "--currency", "--cash"]
    : action === "account" ? ["--root", "--account"] : ["--root", "--account", "--intent-file"];
  const values: Record<string, string> = Object.create(null);
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!key || !allowed.includes(key) || !value || value.startsWith("--") || Object.hasOwn(values, key)) throw new Error(USAGE);
    values[key] = value;
  }
  if (allowed.some(key => !values[key])) throw new Error(USAGE);
  return { action: action as Action, values };
}

/** The selected private root and complete intent are always caller supplied. */
export async function runPaperCommand(args: readonly string[], signal: AbortSignal) {
  signal.throwIfAborted();
  const { action, values } = parse(args);
  const state = appRoot();
  const root = privateRoot(values["--root"]!, state);
  const accountRef = values["--account"]!;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(accountRef)) throw new Error("Invalid paper account ID.");
  const target: ExecutionTarget = { adapterId: "local-paper", accountRef, mode: "paper" };
  const ledger = join(root, "orders.json");
  if (action === "init") {
    if (!/^[A-Z]{3,8}$/.test(values["--currency"]!)) throw new Error("Invalid paper balance currency.");
    parseDecimal(values["--cash"]!);
    if (existsSync(ledger)) throw new Error("Paper account already exists; use paper account to inspect it.");
    const paper = createLocalPaperService({ root, target,
      openingAccount: { balances: [{ currency: values["--currency"]!, cash: values["--cash"]! }], positions: [] } });
    return { action, visibility: "private-paper" as const, account: await paper.adapter.account(signal) };
  }
  if (!existsSync(ledger)) throw new Error("Paper account does not exist; initialize it explicitly first.");
  const paper = createLocalPaperService({ root, target });
  if (action === "account") return { action, visibility: "private-paper" as const, account: await paper.adapter.account(signal) };
  const intent = selectedIntent(values["--intent-file"]!, state, target);
  const outcome = action === "submit" ? await submitOrder(paper.adapter, intent, { signal })
    : action === "lookup" ? await lookupOrder(paper.adapter, intent, signal)
      : await cancelOrder(paper.adapter, intent, { signal });
  return { action, visibility: "private-paper" as const, outcome };
}

export function paperCommandOk(result: Awaited<ReturnType<typeof runPaperCommand>>): boolean {
  if ("account" in result) return true;
  return result.outcome.status === "submitted" || result.outcome.status === "found" || result.outcome.status === "not-found"
    || result.outcome.status === "resolved";
}
