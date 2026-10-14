import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { lock } from "proper-lockfile";
import { validateModelOAuthCredential, type ModelOAuthCredential } from "../../types/model-auth.ts";

/** A selected provider shares Pi's auth.json and its proper-lockfile path. */
export class PiOAuthStore {
  private readonly path: string;
  private readonly provider: string;

  constructor(provider: string, authPath: string) {
    if (!provider || !isAbsolute(authPath) || basename(authPath).toLowerCase() !== "auth.json") {
      throw new Error("Invalid Pi OAuth link.");
    }
    this.provider = provider;
    this.path = resolve(authPath);
  }

  private load(): Record<string, unknown> {
    try {
      const text = readFileSync(this.path, "utf8");
      if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error("oversized");
      const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
      return value as Record<string, unknown>;
    } catch { throw new Error("Linked Pi auth.json is missing or invalid; original file was not changed."); }
  }

  private async exclusive<T>(operation: (assertLease: () => void) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const deadline = Date.now() + 30_000;
    let compromised = false;
    let release: (() => Promise<void>) | undefined;
    for (;;) {
      signal?.throwIfAborted();
      if (!existsSync(this.path)) throw new Error("Linked Pi auth.json is missing; original file was not changed.");
      try {
        release = await lock(this.path, { realpath: false, stale: 30_000, update: 5_000,
          onCompromised: () => { compromised = true; } });
        break;
      } catch (error) {
        const failure = error as NodeJS.ErrnoException;
        const windowsRace = process.platform === "win32" && ["EPERM", "EACCES", "EBUSY"].includes(failure.code ?? "")
          && (failure.syscall === "mkdir" || failure.syscall === "rmdir") && typeof failure.path === "string"
          && resolve(failure.path) === `${this.path}.lock`;
        if ((!windowsRace && failure.code !== "ELOCKED") || Date.now() >= deadline) throw new Error("Linked Pi auth.json is busy or unavailable.");
        await delay(40, undefined, { signal });
      }
    }
    try {
      signal?.throwIfAborted();
      const assertLease = () => { if (compromised) throw new Error("Linked Pi auth.json lease was lost."); };
      const result = await operation(assertLease);
      assertLease();
      return result;
    } finally { if (!compromised) await release(); }
  }

  async read(signal?: AbortSignal): Promise<ModelOAuthCredential | undefined> {
    if (!existsSync(this.path)) return undefined;
    return this.exclusive(async () => {
      const value = this.load()[this.provider];
      return value === undefined ? undefined : validateModelOAuthCredential(value);
    }, signal);
  }

  async modify(update: (current: ModelOAuthCredential | undefined) => Promise<ModelOAuthCredential | undefined>,
    signal?: AbortSignal): Promise<ModelOAuthCredential | undefined> {
    if (!existsSync(this.path)) return undefined;
    return this.exclusive(async assertLease => {
      const data = this.load(), raw = data[this.provider];
      if (raw === undefined) return undefined;
      const current = validateModelOAuthCredential(raw);
      const next = await update(current);
      assertLease();
      if (next) {
        data[this.provider] = validateModelOAuthCredential(next);
        // Match Pi's in-place write while holding the same auth.json lock; existing ACLs stay intact.
        writeFileSync(this.path, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
        return validateModelOAuthCredential(next);
      }
      return current;
    }, signal);
  }
}
