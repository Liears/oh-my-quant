import type { ExtensionDefinition } from "../extensions/index.ts";
import { BUILTIN_TOOLS, listBuiltinToolCapabilities } from "../tools/registry.ts";

/** Existing implementations remain owned by their data/quant/storage modules. */
export const builtinQuantExtension: ExtensionDefinition = {
  manifest: { id: "whyj.core", version: "1.0.0", apiVersion: 1, tools: BUILTIN_TOOLS.map(tool => tool.name), skills: [], commands: ["quant-capabilities"] },
  activate: () => ({ tools: BUILTIN_TOOLS, skills: [], commands: [{ name: "quant-capabilities", description: "Inspect the built-in capability declarations without executing tools", async execute(_args, signal) {
    signal.throwIfAborted(); return listBuiltinToolCapabilities();
  } }] }),
};
