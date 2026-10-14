import type { ParsedCommand } from "../../types/commands.ts";

/** Shared pure checks for preflight and direct host calls; no configuration or extension reads. */
export function piConfigArgumentError(flags: ParsedCommand["flags"], positional: string[]): string | undefined {
  const action = flags.pi;
  if (positional.length || Object.keys(flags).some(key => !["pi", "from", "provider", "model", "review"].includes(key))
    || Object.values(flags).some(value => typeof value !== "string" || !value.trim())
    || !["list", "preview", "apply"].includes(String(action))
    || (action === "apply" ? typeof flags.review !== "string" : flags.review !== undefined)
    || action === "list" && (flags.provider !== undefined || flags.model !== undefined)) {
    return "Use /config --pi list|preview|apply with nonempty values; apply needs --review.";
  }
  return;
}

export function extensionArgumentError(flags: ParsedCommand["flags"], positional: string[]): string | undefined {
  const action = flags.extensions === true ? "list" : flags.extensions;
  if (!["list", "enable", "disable", "reload"].includes(String(action)) || Object.keys(flags).length !== 1
    || positional.length !== (action === "list" ? 0 : 1) || positional.some(value => !value.trim())) {
    return "Use /config --extensions list or /config --extensions enable|disable|reload <id>.";
  }
  return;
}
