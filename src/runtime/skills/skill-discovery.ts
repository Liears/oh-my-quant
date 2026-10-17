import { discoverSkills } from "../../agent/src/skills.ts";
import { NodeExecutionEnv } from "../../agent/src/session-runtime/node.ts";
import { loadSettings } from "../../storage/index.ts";
import { skillPaths } from "./skill-store.ts";

/** One-shot discovery uses the same settings and paths as the application host. */
export async function discoverRuntimeSkills(cwd = process.cwd()) {
  const settings = loadSettings();
  const discovered = await discoverSkills({ cwd, env: new NodeExecutionEnv({ cwd }),
    extraPaths: skillPaths(), integrations: settings.skillIntegrations });
  return discovered.skills;
}
