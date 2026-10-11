/** Isolated process fixture for cache commit/crash tests. Never uses the real workspace. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveBars } from "../../src/bars.ts";
import { subscribeFileEvents } from "../../src/fs-events.ts";

const root = process.env.OHQUANT_DIR;
if (!root || !root.includes("ohq-snapshot-")) throw new Error("A dedicated snapshot test directory is required.");
const offset = Number(process.argv[2]);
if (process.argv[3] === "crash") {
  subscribeFileEvents(event => {
    if (event.detail !== "immutable bars revision") return;
    writeFileSync(join(root, "archive-written"), "ready");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
    throw new Error("Crash fixture was not terminated by its parent.");
  });
}
const date = new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
const close = 100 + offset;
await saveBars("AAPL", "financial-datasets", [{ date, open: close, high: close, low: close, close, volume: 10, amount: 100 }]);
