import { COMMAND_CATALOG } from "./command-catalog.ts";
import { commandHelpResult } from "./command-help.ts";
import { parseDoctorPhases } from "./doctor-phases.ts";
import { piConfigArgumentError, extensionArgumentError } from "./config-command-arguments.ts";
import { toolProbeSchemaResult } from "./tool-probe-schema.ts";
import { AKSHARE_PUBLIC_INDEX_ENDPOINTS } from "../source/index.ts";
import type { CommandResult, ParsedCommand } from "../types/commands.ts";

/** Pure preflight: run before activity changes, configuration reads and command side effects. */
export function commandPreflight(parsed: ParsedCommand): CommandResult | undefined {
  const { command, flags, positional } = parsed;
  const fail = (message: string): CommandResult => ({ success: false, message: `${message} Use ${command ? `/${command} --help` : "/help"} for usage.` });
  if (parsed.argumentError) return fail(parsed.argumentError);
  const help = commandHelpResult(parsed);
  if (help) return help;
  if (!COMMAND_CATALOG.some(entry => entry.name === `/${command}`)) return { success: false, message: `Unknown /${command}. Run /help to see available slash commands.` };
  if (command === "doctor" && flags.schema !== undefined) {
    if (flags.installed === undefined) return toolProbeSchemaResult(flags, positional);
    if (flags.installed !== true) return fail("--installed is a no-value flag.");
    const { installed: _installed, ...staticFlags } = flags;
    const declaration = toolProbeSchemaResult(staticFlags, positional);
    if (!declaration.success) return declaration;
    const routes = (declaration.data as { routes: Array<{ provider: string; endpoint: string }> }).routes;
    if (routes.some(route => route.provider !== "akshare" || !AKSHARE_PUBLIC_INDEX_ENDPOINTS.includes(route.endpoint as typeof AKSHARE_PUBLIC_INDEX_ENDPOINTS[number])))
      return fail("--installed applies only to AKShare index routes; add --provider akshare and/or --endpoint.");
    return;
  }
  if (command === "doctor" && flags.installed !== undefined) return fail("--installed requires --schema.");
  const keys = Object.keys(flags);
  let allowed: string[] = [];
  if (command === "config" && (flags.pi !== undefined || flags.extensions !== undefined)) {
    const error = flags.pi !== undefined ? piConfigArgumentError(flags, positional) : extensionArgumentError(flags, positional);
    return error ? fail(error) : undefined;
  }
  if (command === "doctor" && flags.tool !== undefined) {
    if (positional.length || flags.phase !== undefined || typeof flags.tool !== "string" || !flags.tool.trim()) return fail("Use --tool NAME with endpoint flags, without --phase or positional arguments.");
    return; // Endpoint parameter names/types are checked against the selected tool's schema.
  }
  if (command === "doctor") allowed = ["phase"];
  if (command === "resume") allowed = ["task"];
  const action = positional[0] || "list";
  if (command === "skill") {
    allowed = action === "list" ? ["scope", "source"] : action === "install" ? ["repo"]
      : action === "info" ? ["name", "skill", "check", "check-network"] : action === "run" || action === "trigger" ? ["name", "skill"]
      : action === "audit" ? ["record", "json", "markdown"] : [];
  }
  const unknown = keys.find(key => !allowed.includes(key));
  if (unknown) return fail(`Unknown option --${unknown}.`);
  if (["clear", "exit", "help", "artifact", "config", "doctor"].includes(command) && positional.length) return fail("This command does not accept positional arguments.");
  if (command === "doctor") {
    try { parseDoctorPhases(flags.phase); } catch (error) { return fail((error as Error).message); }
  }
  if (command === "resume" && (flags.task !== undefined ? flags.task !== true || positional.length > 0 : positional.length > 1)) return fail("Use one session ID or --task by itself.");
  if (command === "portfolio") {
    const count = positional.length;
    const valid = action === "list" ? count <= 1 : action === "create" ? count >= 2 : action === "rename" || action === "add" ? count >= 3
      : action === "remove" ? count === 3 : action === "delete" ? count === 2 : action === "import";
    if (!valid) return fail("Invalid portfolio action or argument count.");
  }
  if (command === "skill") {
    if (keys.some(key => key === "check" || key === "check-network" ? flags[key] !== true : typeof flags[key] !== "string" || !(flags[key] as string).trim())) return fail("Use non-empty option values; --check and --check-network take no value.");
    if (action === "list" && (positional.length > 1 || keys.length > 1)) return fail("List accepts at most one scope/source filter and no extra arguments.");
    if (["info", "install", "run", "trigger"].includes(action)) {
      const selectors = [positional[1], ...keys.filter(key => key !== "check" && key !== "check-network").map(key => flags[key])].filter(value => value !== undefined);
      if (selectors.length !== 1 || !String(selectors[0]).trim()) return fail("Specify exactly one skill name or repository, by position or option.");
      if ((action === "info" || action === "install") && positional.length > 2) return fail("Unexpected extra arguments.");
    }
    if (action === "audit") {
      const target = positional[1];
      if (positional.length !== 2 || !["macro-regime-detector", "position-sizer"].includes(String(target)))
        return fail("Audit supports macro-regime-detector or position-sizer reports.");
      const recordOnly = target === "macro-regime-detector" && keys.length === 1 && typeof flags.record === "string";
      const reportPair = keys.length === 2 && typeof flags.json === "string" && typeof flags.markdown === "string";
      if (!recordOnly && !reportPair)
        return fail(target === "position-sizer" ? "Use both --json REPORT.json and --markdown REPORT.md."
          : "Use --record PATH, or both --json REPORT.json and --markdown REPORT.md.");
    }
  }
  return;
}
