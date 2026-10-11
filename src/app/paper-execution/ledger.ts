import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { atomicWriteJson, withFileLockAsync } from "../../storage/src/atomic-file.ts";
import { prepareOrderIntent, validateOrderSnapshot } from "../../execution/index.ts";
import type { ExecutionInstrument, ExecutionTarget, OrderSnapshot, PreparedOrder } from "../../execution/index.ts";
import { formatDecimal, parseDecimal } from "./decimal.ts";

export interface OpeningPaperAccount {
  balances: Array<{ currency: string; cash: string }>;
  positions: Array<{ instrument: ExecutionInstrument; quantity: string }>;
}
export interface PaperOrderRecord { prepared: PreparedOrder; order: OrderSnapshot }
export interface PaperLedger {
  version: 1;
  target: ExecutionTarget;
  balances: OpeningPaperAccount["balances"];
  positions: OpeningPaperAccount["positions"];
  orders: PaperOrderRecord[];
}

function digest(body: PaperLedger): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
export function instrumentKey(instrument: ExecutionInstrument): string {
  return JSON.stringify([instrument.venue, instrument.symbol, instrument.currency]);
}
function validCurrency(value: string): boolean { return typeof value === "string" && /^[A-Z]{3,8}$/.test(value); }
function validInstrument(value: ExecutionInstrument): boolean {
  return value && typeof value === "object" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value.symbol)
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value.venue) && validCurrency(value.currency);
}
function validateLedger(body: PaperLedger, target: ExecutionTarget): void {
  if (body.version !== 1 || JSON.stringify(body.target) !== JSON.stringify(target)
    || !Array.isArray(body.balances) || !Array.isArray(body.positions) || !Array.isArray(body.orders)) throw new Error("Paper ledger target or schema mismatch");
  const currencies = new Set<string>(), instruments = new Set<string>(), ids = new Set<string>();
  for (const balance of body.balances) {
    if (!validCurrency(balance.currency) || currencies.has(balance.currency)) throw new Error("Invalid paper balance currency");
    currencies.add(balance.currency); formatDecimal(parseDecimal(balance.cash));
  }
  for (const position of body.positions) {
    if (!validInstrument(position.instrument)) throw new Error("Invalid paper position");
    const key = instrumentKey(position.instrument);
    if (instruments.has(key)) throw new Error("Duplicate paper position");
    instruments.add(key); formatDecimal(parseDecimal(position.quantity));
  }
  for (const record of body.orders) {
    const prepared = prepareOrderIntent(record.prepared.intent, target);
    if (prepared.intentHash !== record.prepared.intentHash || ids.has(prepared.intent.clientOrderId)) throw new Error("Invalid paper order identity");
    ids.add(prepared.intent.clientOrderId);
    validateOrderSnapshot(record.order, prepared);
  }
}

export class PaperLedgerFile {
  private readonly path: string;
  private readonly anchor: string;
  constructor(root: string, private readonly target: ExecutionTarget, private readonly opening?: OpeningPaperAccount) {
    if (!isAbsolute(root)) throw new Error("Paper ledger root must be an explicit absolute path");
    const directory = resolve(root);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, "orders.json");
    this.anchor = join(directory, "orders.lock-anchor");
    writeFileSync(this.anchor, "", { flag: "a", mode: 0o600 });
  }

  private read(): PaperLedger {
    if (!existsSync(this.path)) {
      if (!this.opening) throw new Error("Opening paper account is required for a new ledger");
      const body: PaperLedger = { version: 1, target: structuredClone(this.target), balances: structuredClone(this.opening.balances),
        positions: structuredClone(this.opening.positions), orders: [] };
      validateLedger(body, this.target);
      this.write(body);
      return body;
    }
    const envelope = JSON.parse(readFileSync(this.path, "utf8")) as { body?: PaperLedger; hash?: string };
    if (!envelope || !envelope.body || typeof envelope.hash !== "string" || envelope.hash !== digest(envelope.body)) throw new Error("Paper ledger integrity check failed");
    validateLedger(envelope.body, this.target);
    return envelope.body;
  }

  private write(body: PaperLedger): void {
    validateLedger(body, this.target);
    atomicWriteJson(this.path, { body, hash: digest(body) });
  }

  async transact<T>(signal: AbortSignal, operation: (body: PaperLedger, save: () => void) => T): Promise<T> {
    return withFileLockAsync(this.anchor, () => {
      const body = this.read();
      return operation(body, () => this.write(body));
    }, signal);
  }
}
