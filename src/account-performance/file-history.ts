import { readFileSync, statSync } from "node:fs";
import { validateAccountHistory } from "./validation.ts";
import type { AccountHistory } from "./types.ts";

/** Read a user-selected, normalized complete statement; broker export conversion remains outside this contract. */
export function readAccountHistoryFile(path: string): AccountHistory {
  let text: string;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error("Invalid account history file.");
    text = readFileSync(path, "utf8");
  } catch { throw new Error("Could not read the selected account history file."); }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error("Invalid normalized account history JSON."); }
  validateAccountHistory(value as AccountHistory);
  return value as AccountHistory;
}
