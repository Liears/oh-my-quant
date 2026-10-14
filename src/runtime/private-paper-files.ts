/** Shared host-selected private paths for file-based paper execution commands. */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { prepareOrderIntent } from "../execution/index.ts";
import type { ExecutionTarget, OrderIntent } from "../execution/index.ts";
import { resolveOhquantDir } from "../storage/src/dirs.ts";

function inside(path: string, root: string): boolean {
  const target = process.platform === "win32" ? path.toLowerCase() : path;
  const base = process.platform === "win32" ? root.toLowerCase() : root;
  return target === base || target.startsWith(base + sep);
}

export function appRoot(): string {
  const raw = resolve(resolveOhquantDir());
  return existsSync(raw) ? realpathSync(raw) : raw;
}

export function privateRoot(value: string, state: string): string {
  if (!isAbsolute(value)) throw new Error("Paper root must be an explicit absolute path.");
  let path: string;
  try { path = existsSync(value) ? realpathSync(value) : join(realpathSync(dirname(value)), basename(value)); }
  catch { throw new Error("Paper root parent directory must already exist."); }
  if (inside(path, state)) throw new Error("Paper ledger cannot be placed in the app state directory.");
  return path;
}

export function selectedIntent(value: string, state: string, target: ExecutionTarget): OrderIntent {
  if (!isAbsolute(value) || !value.toLowerCase().endsWith(".json")) throw new Error("Select an absolute JSON order-intent file.");
  let file: string;
  try { file = realpathSync(value); } catch { throw new Error("Selected order-intent file cannot be read."); }
  if (inside(file, state)) throw new Error("Order intent cannot be read from the app state directory.");
  if (statSync(file).size > 32_768) throw new Error("Selected order-intent file is too large.");
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Error("Selected order-intent JSON is malformed."); }
  return prepareOrderIntent(raw as OrderIntent, target).intent;
}
