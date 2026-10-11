import fs from "node:fs";
import { resolve } from "node:path";

export const fault = { active: false, attempts: 0, mode: process.argv.at(-1) ?? "" };
const target = process.env.WHYJ_LOCK_FIXTURE_PATH;
if (!target || !target.includes("whyj-lock-fault-")) throw new Error("An isolated lock fixture path is required.");
const mkdir = fs.mkdirSync;
fs.mkdirSync = ((...args: Parameters<typeof fs.mkdirSync>) => {
  if (fault.active && resolve(String(args[0])) === resolve(`${target}.lock`)) {
    fault.attempts++;
    if (fault.mode !== "transient" || fault.attempts <= 3) throw Object.assign(new Error("Injected Windows lock access failure"), {
      code: "EPERM", syscall: fault.mode === "other-syscall" ? "open" : "mkdir", path: `${target}.lock`,
    });
  }
  return mkdir(...args);
}) as typeof fs.mkdirSync;
