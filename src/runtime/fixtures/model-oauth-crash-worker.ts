import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { getProvider } from "../../agent/src/kernel/llm.ts";
import { resolveModelOAuth } from "../../agent/src/model-oauth.ts";

const [root, id] = process.argv.slice(2);
if (!root || !id || !resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid OAuth fixture directory.");
const provider = getProvider("anthropic")!;
await resolveModelOAuth(provider.id, id, undefined, root, { ...provider, auth: { oauth: {
  name: "Crash fixture", login: async () => { throw new Error("Unexpected login."); },
  refresh: async current => {
    if (current.access !== "expired") throw new Error("Unexpected fixture credential.");
    // The parent kills this process only after refresh has acquired the real credential lease.
    writeFileSync(join(root, "refresh-entered"), "ready");
    await Bun.sleep(30000);
    throw new Error("Crash fixture was not terminated.");
  },
  toAuth: async credential => ({ apiKey: credential.access }),
} } });
