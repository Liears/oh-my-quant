import { loginModelOAuth } from "../../agent/src/model-oauth.ts";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

const root = process.argv[2];
if (!root || !resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid OAuth bundle fixture root.");
const controller = new AbortController();
let prompted = false;
try {
  await loginModelOAuth("openai-codex", {
    signal: controller.signal,
    prompt: async prompt => {
      if (prompt.type !== "select" || !prompt.options.some(option => option.id === "device_code")) throw new Error("Unexpected Codex prompt.");
      prompted = true; controller.abort(); throw new Error("Fixture stops before authorization.");
    },
    notify: () => { throw new Error("Unexpected OAuth network stage."); },
  }, root);
} catch {
  if (!prompted || !controller.signal.aborted) throw new Error("Bundled OAuth flow did not reach the provider's login prompt.");
}
process.stdout.write("prompt reached; cancelled before network\n");
