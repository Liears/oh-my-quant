import { basename, join } from "node:path";
import { writeFileSync } from "node:fs";
import { saveArtifact } from "../../src/artifacts.ts";
import { subscribeFileEvents } from "../../src/fs-events.ts";

const root = process.env.OHQUANT_DIR;
if (!root || !basename(root).startsWith("ohq-report-versions-")) throw new Error("Dedicated report test directory required");
if (process.argv[2] === "crash") subscribeFileEvents(event => {
  if (event.detail === "report HTML") {
    writeFileSync(join(root, "checkpoint"), "archive complete");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
  }
});
const deadline = Date.now() + 10_000;
for (;;) {
  try {
    const title = `Writer ${process.argv[2]}`;
    saveArtifact("parallel", `<html>${title}</html>`, { title });
    break;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ELOCKED" || Date.now() >= deadline) throw error;
    await Bun.sleep(25);
  }
}
