import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { LocalSessionFile } from "../index.ts";
import { JsonlSessionStorage } from "../../agent/src/session-runtime/harness/session/jsonl-storage.ts";
import { Session } from "../../agent/src/session-runtime/harness/session/session.ts";
import type { SessionTreeEntry } from "../../agent/src/session-runtime/harness/types.ts";

// Synthetic local I/O measurement, independent of accounts and normal user sessions.
const root = mkdtempSync(join(tmpdir(), "ohq-session-measure-"));
try {
  for (const count of [1_000, 20_000]) {
    const path = join(root, `${count}.jsonl`);
    const entries: SessionTreeEntry[] = Array.from({ length: count }, (_, i) => ({
      type: "message", id: `entry-${i}`, parentId: i === 0 ? null : `entry-${i - 1}`,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "user", content: `Synthetic research ${i} ` + "x".repeat(500), timestamp: i },
    }));
    const file = new LocalSessionFile();
    await JsonlSessionStorage.create(file, path, { cwd: root, sessionId: `synthetic-${count}`, entries });
    const openStart = performance.now();
    const session = new Session(await JsonlSessionStorage.open(file, path));
    const openMs = performance.now() - openStart;
    const measurements: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      await session.appendMessage({ role: "user", content: `Measured append ${i}`, timestamp: count + i });
      measurements.push(performance.now() - started);
    }
    const reopened = new Session(await JsonlSessionStorage.open(file, path));
    if ((await reopened.getBranch()).length !== count + 20) throw new Error("Measurement lost research history");
    measurements.sort((a, b) => a - b);
    process.stdout.write(JSON.stringify({ entries: count, bytes: statSync(path).size, samples: measurements.length, openMs, appendP50Ms: measurements[9], appendP95Ms: measurements[18], appendMaxMs: measurements[19] }) + "\n");
  }
} finally {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected measurement directory");
  rmSync(root, { recursive: true, force: true });
}
