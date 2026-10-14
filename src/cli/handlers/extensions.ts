import type { CommandHandler, ExtensionAction } from "../../types/commands.ts";
import { RuntimeExtensions } from "../../runtime/extensions.ts";
import { extensionArgumentError } from "../../runtime/workspace/config-command-arguments.ts";

export const extensionsHandler: CommandHandler = async (flags, positional, ctx) => {
  const action = flags.extensions === true ? "list" : flags.extensions;
  const error = extensionArgumentError(flags, positional);
  if (error) return { success: false, message: error };
  if (ctx.manageExtensions) return ctx.manageExtensions(action as ExtensionAction, positional[0], ctx.commandSignal);
  if (ctx.agentSession) return { success: false, message: "This host has not provided extension management for its active session." };
  const runtime = new RuntimeExtensions();
  try { return await runtime.manage(action as ExtensionAction, positional[0], ctx.commandSignal); }
  finally { await runtime.dispose(); }
};
