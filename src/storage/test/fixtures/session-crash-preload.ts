import { mock } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";

// Fault injection at the OS rename boundary, isolated to this child process.
// Real open/write/fsync have already run; no production test hooks are needed.
const original = { ...fs };
const root = process.env.SESSION_CRASH_ROOT!;
const point = process.env.SESSION_CRASH_POINT!;
let attempts = 0;
mock.module("node:fs", () => ({
  ...original,
  renameSync: (source: fs.PathLike, destination: fs.PathLike) => {
    if (!String(destination).endsWith(".jsonl")) return original.renameSync(source, destination);
    if (point === "retry" || point === "denied") {
      attempts++;
      original.writeFileSync(join(root, "checkpoint"), JSON.stringify({ attempts, previous: original.readFileSync(destination, "utf8") }));
      if (point === "denied" || attempts <= 3) throw Object.assign(new Error("Injected rename EPERM"), { code: "EPERM" });
      return original.renameSync(source, destination);
    }
    if (point === "after") original.renameSync(source, destination);
    original.writeFileSync(join(root, "checkpoint"), JSON.stringify({ source: String(source), destination: String(destination), point }));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  },
}));
