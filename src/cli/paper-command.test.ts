import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { OrderIntent } from "../execution/index.ts";

let state: string, privateParent: string, previous: string | undefined;
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const root = () => join(privateParent, "paper-ledger");
const flags = () => ["--root", root(), "--account", "paper-usd-1"];
const intent = (clientOrderId = "paper-order-1", quantity = "2"): OrderIntent => ({
  version: 1, target: { adapterId: "local-paper", accountRef: "paper-usd-1", mode: "paper" },
  clientOrderId, instrument: { symbol: "AAPL", venue: "NASDAQ", currency: "USD" }, side: "buy", type: "limit",
  quantity, limitPrice: "10", maxOrderNotional: "100", timeInForce: "gtc",
});

beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  state = mkdtempSync(join(tmpdir(), "whyj-paper-cli-state-"));
  privateParent = mkdtempSync(join(tmpdir(), "whyj-paper-cli-private-"));
  process.env.OHQUANT_DIR = state;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  for (const path of [state, privateParent]) {
    if (!resolve(path).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected paper CLI fixture path");
    rmSync(path, { recursive: true, force: true });
  }
});

function run(action: string, args: string[]) {
  const child = Bun.spawnSync({ cmd: [process.execPath, "src/index.ts", "--json", "paper", action, ...args], cwd: process.cwd(),
    env: { ...process.env, OHQUANT_DIR: state }, stdout: "pipe", stderr: "pipe", timeout: 10_000 });
  return { exit: child.exitCode, envelope: JSON.parse(decode(child.stdout)), raw: decode(child.stdout), error: decode(child.stderr) };
}

test("a real CLI paper account survives restart, deduplicates a submitted intent and supports lookup/cancel", () => {
  writeFileSync(join(state, "settings.json"), "{invalid model settings");
  const opened = run("init", [...flags(), "--currency", "USD", "--cash", "100"]);
  expect(opened.exit).toBe(0);
  expect(opened.envelope).toMatchObject({ ok: true, command: "paper", data: { action: "init", visibility: "private-paper",
    account: { balances: [{ currency: "USD", cash: "100", availableCash: "100" }] } } });
  expect(run("init", [...flags(), "--currency", "USD", "--cash", "9999"]).exit).toBe(1);
  expect(run("account", flags()).envelope.data.account.balances[0].cash).toBe("100");
  const file = join(privateParent, "intent.json");
  writeFileSync(file, JSON.stringify(intent()));
  const first = run("submit", [...flags(), "--intent-file", file]);
  expect(first.exit).toBe(0);
  expect(first.envelope).toMatchObject({ data: { outcome: { status: "submitted", order: { status: "open", quantity: "2" } } } });
  const repeated = run("submit", [...flags(), "--intent-file", file]);
  expect(repeated.exit).toBe(0);
  expect(repeated.envelope.data.outcome.order.orderId).toBe(first.envelope.data.outcome.order.orderId);
  expect(run("account", flags()).envelope.data.account.balances[0].availableCash).toBe("80");
  expect(run("lookup", [...flags(), "--intent-file", file]).envelope.data.outcome).toMatchObject({ status: "found", order: { status: "open" } });
  const cancelled = run("cancel", [...flags(), "--intent-file", file]);
  expect(cancelled.exit).toBe(0);
  expect(cancelled.envelope.data.outcome).toMatchObject({ status: "resolved", order: { status: "cancelled", filledQuantity: "0" } });
  expect(run("account", flags()).envelope.data.account.balances[0].availableCash).toBe("100");
  expect(run("lookup", [...flags(), "--intent-file", file]).envelope.data.outcome.order.status).toBe("cancelled");
  expect(existsSync(join(root(), "orders.json"))).toBe(true);
  expect(existsSync(join(state, "data"))).toBe(false);
  expect(readFileSync(join(state, "settings.json"), "utf8")).toBe("{invalid model settings");
}, 35_000);

test("conflicting client IDs and wrong targets never create a second paper order", () => {
  expect(run("init", [...flags(), "--currency", "USD", "--cash", "100"]).exit).toBe(0);
  const file = join(privateParent, "intent.json");
  writeFileSync(file, JSON.stringify(intent()));
  const first = run("submit", [...flags(), "--intent-file", file]);
  expect(first.exit).toBe(0);
  writeFileSync(file, JSON.stringify(intent("paper-order-1", "3")));
  const conflict = run("submit", [...flags(), "--intent-file", file]);
  expect(conflict.exit).toBe(1);
  expect(conflict.envelope).toMatchObject({ ok: false, data: { outcome: { status: "not-submitted" } } });
  expect(run("account", flags()).envelope.data.account.balances[0].availableCash).toBe("80");
  writeFileSync(file, JSON.stringify({ ...intent(), target: { adapterId: "live-broker", accountRef: "real", mode: "live" } }));
  const wrong = run("submit", [...flags(), "--intent-file", file]);
  expect(wrong.exit).toBe(1);
  expect(wrong.envelope.error.code).toBe("paper_failed");
  expect(readFileSync(join(root(), "orders.json"), "utf8")).not.toContain("live-broker");
}, 25_000);

test("invalid setup and app-state paths fail before creating a paper ledger", () => {
  const badCash = run("init", [...flags(), "--currency", "USD", "--cash", "NaN"]);
  expect(badCash.exit).toBe(1);
  expect(existsSync(root())).toBe(false);
  const stateRoot = run("init", ["--root", join(state, "paper"), "--account", "paper-usd-1", "--currency", "USD", "--cash", "100"]);
  expect(stateRoot.exit).toBe(1);
  expect(existsSync(join(state, "paper"))).toBe(false);
  const absent = run("submit", [...flags(), "--intent-file", join(privateParent, "missing.json")]);
  expect(absent.exit).toBe(1);
  expect(existsSync(root())).toBe(false);
  const repeated = run("init", [...flags(), "--cash", "100", "--cash", "200", "--currency", "USD"]);
  expect(repeated.exit).toBe(1);
  expect(existsSync(root())).toBe(false);
  expect(run("init", [...flags(), "--currency", "USD", "--cash", "100"]).exit).toBe(0);
  const privateIntent = join(state, "order-intent.json");
  writeFileSync(privateIntent, JSON.stringify(intent()));
  const rejected = run("submit", [...flags(), "--intent-file", privateIntent]);
  expect(rejected.exit).toBe(1);
  expect(rejected.envelope.error.code).toBe("paper_failed");
  expect(readFileSync(join(root(), "orders.json"), "utf8")).not.toContain("paper-order-1");
}, 25_000);
