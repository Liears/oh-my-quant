import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { getProvider } from "../../../agent/src/kernel/llm.ts";
import { resolveModelOAuth } from "../../../agent/src/model-oauth.ts";

const [root, id, worker] = process.argv.slice(2);
if (!root || !id || !worker || !resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid OAuth fixture directory.");
const provider = getProvider("anthropic")!;
writeFileSync(join(root, `ready-${worker}`), "ready");
const deadline = Date.now() + 10000;
while (!existsSync(join(root, "go"))) {
  if (Date.now() >= deadline) throw new Error("OAuth fixture barrier timed out.");
  await Bun.sleep(10);
}
const result = await resolveModelOAuth(provider.id, id, undefined, root, { ...provider, auth: { oauth: {
  name: "Process fixture", login: async () => { throw new Error("Unexpected login."); },
  refresh: async current => {
    if (current.access !== "expired") throw new Error("Unexpected second refresh.");
    appendFileSync(join(root, "refresh-count"), "refresh\n");
    await Bun.sleep(100);
    return { type: "oauth", access: "process-rotation", refresh: "process-refresh", expires: Date.now() + 30 * 60000 };
  },
  toAuth: async credential => ({ apiKey: credential.access }),
} } });
if (result.auth.apiKey !== "process-rotation") throw new Error("Unexpected fixture auth result.");
process.stdout.write("ready\n");
