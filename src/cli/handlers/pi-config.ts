import { inspectPiConnections, inspectPiImport } from "../../runtime/models/pi-config-import.ts";
import type { CommandHandler } from "../types.ts";
import { piConfigArgumentError } from "../../runtime/workspace/config-command-arguments.ts";

export const piConfigHandler: CommandHandler = async (flags, positional, ctx) => {
  const error = piConfigArgumentError(flags, positional);
  if (error) return { success: false, message: error };
  const action = flags.pi;
  try {
    ctx.commandSignal?.throwIfAborted();
    const directory = flags.from as string | undefined;
    if (action === "list") {
      const connections = inspectPiConnections(directory);
      return { success: true, message: ["Pi connections (read-only)", ...connections.map(item =>
        `${item.provider} · file models: ${item.models.join(", ") || "none"} · catalog: ${item.builtinModels} · ${item.credential}`)].join("\n"), data: { connections } };
    }
    const result = inspectPiImport({ directory, provider: flags.provider as string | undefined, model: flags.model as string | undefined },
      action === "apply" ? flags.review as string : undefined, ctx.commandSignal);
    return { success: true, data: result, message: [result.applied ? "Pi connection imported" : "Pi import preview (no changes)",
      `${result.sourceProvider} → ${result.targetProvider} / ${result.model}`, `${result.api} · ${result.baseUrl}`,
      `Context ${result.contextWindow} · output ${result.maxTokens} · thinking ${result.thinking}`, `Credentials: ${result.credential}`,
      `Request headers: ${result.metadata.headerCount} (values hidden) · sampling parameters: ${result.metadata.samplingParameterCount} · pricing tiers: ${result.metadata.pricingTierCount}`,
      `Compatibility: ${result.metadata.compatibilityFields.join(", ") || "protocol defaults"} · model URL override: ${result.metadata.modelUrlOverride ? "yes" : "no"}`,
      `Replace existing connection: ${result.replacesConnection ? "yes" : "no"}`, ...result.notes,
      ...(result.applied ? [] : [`Review token: ${result.review}`, "Apply with the same selection and --pi apply --review TOKEN, or leave unchanged."])].join("\n") };
  } catch (error) { return { success: false, message: error instanceof Error ? error.message : "Pi import failed; no settings changed." }; }
};
