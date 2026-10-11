/** Host-selected private binding between a broker client ID and the complete reviewed intent. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { atomicWriteJson, withFileLockAsync } from "../../storage/src/atomic-file.ts";
import { prepareOrderIntent } from "../../execution/index.ts";
import type { ExecutionTarget, OrderReference, PreparedOrder } from "../../execution/index.ts";

interface Binding { prepared: PreparedOrder; phase: "dispatching" }
interface Body { version: 1; target: ExecutionTarget; bindings: Binding[] }
function hash(body: Body): string { return createHash("sha256").update(JSON.stringify(body)).digest("hex"); }

export class AlpacaPaperJournal {
  private readonly path: string;
  private readonly anchor: string;
  constructor(root: string, private readonly target: ExecutionTarget) {
    if (!isAbsolute(root)) throw new Error("Alpaca paper journal requires an explicit absolute root");
    const directory = resolve(root);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, "alpaca-orders.json");
    this.anchor = join(directory, "alpaca-orders.lock-anchor");
    writeFileSync(this.anchor, "", { flag: "a", mode: 0o600 });
  }

  private read(): Body {
    if (!existsSync(this.path)) return { version: 1, target: structuredClone(this.target), bindings: [] };
    const envelope = JSON.parse(readFileSync(this.path, "utf8")) as { body?: Body; hash?: string };
    const body = envelope?.body;
    if (!body || envelope.hash !== hash(body) || body.version !== 1
      || JSON.stringify(body.target) !== JSON.stringify(this.target) || !Array.isArray(body.bindings))
      throw new Error("Alpaca paper journal integrity or account mismatch");
    const ids = new Set<string>();
    for (const binding of body.bindings) {
      const prepared = prepareOrderIntent(binding.prepared.intent, this.target);
      if (binding.phase !== "dispatching" || prepared.intentHash !== binding.prepared.intentHash
        || ids.has(prepared.intent.clientOrderId)) throw new Error("Invalid Alpaca paper journal binding");
      ids.add(prepared.intent.clientOrderId);
    }
    return body;
  }

  private async transact<T>(signal: AbortSignal, action: (body: Body) => T): Promise<T> {
    return withFileLockAsync(this.anchor, () => action(this.read()), signal);
  }

  async check(clientOrderId: string, intentHash: string, signal: AbortSignal): Promise<"bound" | "unbound"> {
    return this.transact(signal, body => {
      const existing = body.bindings.find(binding => binding.prepared.intent.clientOrderId === clientOrderId);
      if (existing && existing.prepared.intentHash !== intentHash) throw new Error("Alpaca client order ID is bound to another intent");
      return existing ? "bound" : "unbound";
    });
  }

  async prepared(reference: OrderReference, signal: AbortSignal): Promise<PreparedOrder> {
    return this.transact(signal, body => {
      const binding = body.bindings.find(item => item.prepared.intent.clientOrderId === reference.clientOrderId);
      if (!binding || binding.prepared.intentHash !== reference.intentHash) throw new Error("Alpaca paper order binding is missing or conflicts");
      return structuredClone(binding.prepared);
    });
  }

  /** Exactly one process reserves dispatch; after a crash, later callers only reconcile. */
  async reserve(prepared: PreparedOrder, signal: AbortSignal): Promise<boolean> {
    return this.transact(signal, body => {
      const existing = body.bindings.find(binding => binding.prepared.intent.clientOrderId === prepared.intent.clientOrderId);
      if (existing) {
        if (existing.prepared.intentHash !== prepared.intentHash) throw new Error("Alpaca client order ID conflict");
        return false;
      }
      body.bindings.push({ prepared: structuredClone(prepared), phase: "dispatching" });
      atomicWriteJson(this.path, { body, hash: hash(body) });
      return true;
    });
  }
}
