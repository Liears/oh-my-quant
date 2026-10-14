import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { lock } from "proper-lockfile";
import { withFileLockAsync, withFileLockAsyncUsing, type AsyncFileLock } from "../../src/atomic-file.ts";

const path = process.env.WHYJ_LOCK_FIXTURE_PATH!;
const mode = process.argv.at(-1) ?? "";
writeFileSync(path, "original");
const controller = new AbortController();
let timer: ReturnType<typeof setTimeout> | undefined;
if (mode === "cancel") timer = setTimeout(() => controller.abort(), 10);
let calls = 0, error: { name: string; code: unknown } | null = null;
let attempts = 0;
const acquire: AsyncFileLock = async (target, options) => {
  attempts++;
  if (mode !== "transient" || attempts <= 3) throw Object.assign(new Error("Injected Windows lock access failure"), {
    code: "EPERM", syscall: mode === "other-syscall" ? "open" : "mkdir", path: `${target}.lock`,
  });
  return lock(target, options);
};
try {
  await withFileLockAsyncUsing(path, () => { calls++; writeFileSync(path, "changed"); }, controller.signal, acquire);
} catch (failure) {
  error = { name: (failure as Error).name, code: (failure as NodeJS.ErrnoException).code };
} finally { if (timer) clearTimeout(timer); }
const beforeRecovery = { calls, text: readFileSync(path, "utf8"), lockExists: existsSync(`${path}.lock`) };
await withFileLockAsync(path, () => { calls++; writeFileSync(path, "recovered"); });
console.log(JSON.stringify({ attempts, error, beforeRecovery, finalCalls: calls, final: readFileSync(path, "utf8") }));
