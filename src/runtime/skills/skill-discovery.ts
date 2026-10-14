import { discoverSkills } from "../../agent/src/skills.ts";
import { NodeExecutionEnv } from "../../agent/src/session-runtime/node.ts";
import { modelImageInputCheck } from "../../agent/src/chart-images.ts";
import { resolveConfiguredModel } from "../../agent/src/model-config.ts";
import { loadSettings } from "../../storage/index.ts";
import { skillPaths } from "./skill-store.ts";
import { prepareRuntimeSkills } from "./skill-readiness.ts";

/** One-shot discovery uses the same settings, paths and readiness policy as the application host. */
export async function discoverRuntimeSkills() {
  const cwd = process.cwd(), settings = loadSettings();
  const discovered = await discoverSkills({ cwd, env: new NodeExecutionEnv({ cwd }),
    extraPaths: skillPaths(), integrations: settings.skillIntegrations });
  return prepareRuntimeSkills(discovered.skills, undefined, cwd, {
    readCapabilities: () => ({ "model-image-input": modelImageInputCheck(resolveConfiguredModel(settings)) }),
  });
}
