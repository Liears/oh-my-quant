import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JsonlSessionRepo } from "../../../agent/src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../../../agent/src/session-runtime/node.ts";

const [root, path, mode, tag = "writer"] = process.argv.slice(2) as [string, string, string, string?];
const repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: root });
const header = JSON.parse(readFileSync(path, "utf8").split("\n")[0]!);
const meta = { id: header.id as string, createdAt: header.timestamp as string, cwd: root, path };
const session = await repo.open(meta);

if (mode === "race") {
  writeFileSync(join(root, `ready-${tag}`), "ready");
  const deadline = Date.now() + 10_000;
  while (!existsSync(join(root, "go"))) {
    if (Date.now() > deadline) throw new Error("Race barrier timed out");
    await Bun.sleep(10);
  }
}
try {
  if (mode === "fork") await repo.fork(meta, { cwd: root });
  else await session.appendMessage({ role: "user", content: `Writer ${tag}`, timestamp: 2 });
  process.stdout.write(JSON.stringify({ status: "committed", tag }));
} catch (error) {
  if (mode !== "race" || (error as NodeJS.ErrnoException).code !== "ESTORAGECONFLICT") throw error;
  process.stdout.write(JSON.stringify({ status: "conflict", tag }));
}
