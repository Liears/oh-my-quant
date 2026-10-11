import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { lock } from "proper-lockfile";
import { isModelOAuthId, validateModelOAuthCredential, type ModelOAuthCredential } from "../../types/model-auth.ts";
import { resolveOhquantDir } from "./dirs.ts";
import { atomicWriteJson } from "./atomic-file.ts";

/** One login generation per opaque ID. An old connection can never read a new account's token. */
export class ModelOAuthFile {
  readonly id: string;
  readonly provider: string;
  private readonly path: string;

  constructor(provider: string, id: string, root = resolveOhquantDir()) {
    if (!isModelOAuthId(id)) throw new Error("Invalid model OAuth reference.");
    if (!provider || /[\x00-\x1f\x7f]/.test(provider)) throw new Error("Invalid model OAuth provider.");
    this.id = id; this.provider = provider; this.path = join(resolve(root), "model-auth", `${id}.json`);
  }

  static create(provider: string, value: ModelOAuthCredential, root = resolveOhquantDir()): ModelOAuthFile {
    const record = validateModelOAuthCredential(value), id = randomUUID();
    mkdirSync(join(resolve(root), "model-auth"), { recursive: true });
    const file = new ModelOAuthFile(provider, id, root);
    file.write(record);
    return file;
  }

  /** A local pointer to Pi's own auth.json; no access or refresh token is copied. */
  static createPiLink(provider: string, authPath: string, root = resolveOhquantDir()): ModelOAuthFile {
    if (!isAbsolute(authPath) || basename(authPath).toLowerCase() !== "auth.json") throw new Error("Invalid Pi OAuth source path.");
    mkdirSync(join(resolve(root), "model-auth"), { recursive: true });
    const file = new ModelOAuthFile(provider, randomUUID(), root);
    atomicWriteJson(file.path, { version: 2, provider, piAuthPath: resolve(authPath) });
    return file;
  }

  readPiLink(): string | undefined {
    let text: string;
    try { text = readFileSync(this.path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("Cannot read model OAuth credentials."); }
    try {
      if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error("oversized");
      const record = JSON.parse(text) as { version: number; provider: string; piAuthPath?: unknown };
      if (record.provider !== this.provider || ![1, 2].includes(record.version)) throw new Error("mismatch");
      if (record.version === 1) return undefined;
      if (typeof record.piAuthPath !== "string" || !isAbsolute(record.piAuthPath)
        || basename(record.piAuthPath).toLowerCase() !== "auth.json") throw new Error("path");
      return resolve(record.piAuthPath);
    } catch { throw new Error("Model OAuth credential file is invalid; sign in again. Original file preserved."); }
  }

  /** Only for a newly created link before its ID is committed in settings. */
  discardUnpublished(): void {
    try { unlinkSync(this.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot discard uncommitted Pi OAuth link."); }
  }

  read(): ModelOAuthCredential | undefined {
    let text: string;
    try { text = readFileSync(this.path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("Cannot read model OAuth credentials."); }
    try {
      if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error("oversized");
      const record = JSON.parse(text) as { version: number; provider: string; credential: unknown };
      if (record.version !== 1 || record.provider !== this.provider) throw new Error("mismatch");
      return validateModelOAuthCredential(record.credential);
    } catch { throw new Error("Model OAuth credential file is invalid; sign in again. Original file preserved."); }
  }

  private write(value: ModelOAuthCredential): void {
    const record = { version: 1, provider: this.provider, credential: validateModelOAuthCredential(value) };
    if (Buffer.byteLength(JSON.stringify(record)) > 4 * 1024 * 1024) throw new Error("Model OAuth credential is too large.");
    atomicWriteJson(this.path, record);
  }

  /** Unlike short settings locks, this lease is asynchronous and heartbeats during token exchange. */
  private async exclusive<T>(operation: (assertLease: () => void) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const deadline = Date.now() + 60_000;
    let compromised = false;
    let release: (() => Promise<void>) | undefined;
    for (;;) {
      signal?.throwIfAborted();
      try {
        release = await lock(this.path, { realpath: false, stale: 90_000, update: 5_000, onCompromised: () => { compromised = true; } });
        break;
      } catch (error) {
        const failure = error as NodeJS.ErrnoException;
        const windowsRace = process.platform === "win32" && ["EPERM", "EACCES", "EBUSY"].includes(failure.code ?? "")
          && (failure.syscall === "mkdir" || failure.syscall === "rmdir") && typeof failure.path === "string" && resolve(failure.path) === `${this.path}.lock`;
        if ((!windowsRace && failure.code !== "ELOCKED") || Date.now() >= deadline) throw new Error("Model OAuth credentials are busy or unavailable.");
        await delay(40, undefined, { signal });
      }
    }
    try {
      signal?.throwIfAborted();
      const assertLease = () => { if (compromised) throw new Error("Model OAuth credential lease was lost."); };
      const result = await operation(assertLease);
      assertLease();
      return result;
    } finally { if (!compromised) await release(); }
  }

  async modify(update: (current: ModelOAuthCredential | undefined) => Promise<ModelOAuthCredential | undefined>, signal?: AbortSignal): Promise<ModelOAuthCredential | undefined> {
    if (!existsSync(this.path)) return undefined;
    return this.exclusive(async assertLease => {
      const current = this.read();
      // A logout that won the lock must not be undone by a waiting refresh.
      if (!current) return undefined;
      const next = await update(current);
      // Persist a successfully rotated token even if the requesting turn was cancelled meanwhile.
      // The caller still observes cancellation; losing a confirmed replacement would strand the account.
      assertLease();
      if (next) this.write(next);
      return next ? validateModelOAuthCredential(next) : current;
    }, signal);
  }

  async delete(signal?: AbortSignal): Promise<void> {
    if (!existsSync(this.path)) return;
    await this.exclusive(async () => {
      try { unlinkSync(this.path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot remove model OAuth credentials."); }
    }, signal);
  }
}
