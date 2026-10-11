import { discoverSkills } from "../agent/src/skills.ts";
import { NodeExecutionEnv } from "../agent/src/session-runtime/node.ts";
import type { CommandHandler, CommandSkill } from "../types/commands.ts";
import { loadSettings } from "../storage/index.ts";
import { skillPaths, installSkills, curatedSkillInfo } from "./store.ts";
import { prepareRuntimeSkills } from "../runtime/skill-readiness.ts";
import { checkSkillPython } from "./python-probe.ts";
import { BREADTH_NETWORK_REQUIREMENT, checkSkillNetwork } from "./network-probe.ts";
import { ETF_NETWORK_REQUIREMENT, checkEtfNetwork } from "./etf-network-probe.ts";
import { checkSkillFiles } from "./file-probe.ts";
import { auditMacroCommand } from "./macro-audit-command.ts";
import { auditPositionCommand } from "./position-audit-command.ts";

function sourceLabel(skill: CommandSkill): string {
  return `${skill.scope}/${skill.source}`;
}

async function loadSkillsFromContext(ctx: Parameters<CommandHandler>[2]): Promise<CommandSkill[]> {
  if (ctx.agentSession) return await ctx.agentSession.getSkills();
  const env = new NodeExecutionEnv({ cwd: process.cwd() });
  const settings = loadSettings();
  const discovered = await discoverSkills({
    cwd: process.cwd(),
    env,
    extraPaths: skillPaths(),
    integrations: settings.skillIntegrations,
  });
  return prepareRuntimeSkills(discovered.skills);
}

const SUBCOMMANDS = new Set(["list", "info", "run", "trigger", "install", "audit"]);

export const skillHandler: CommandHandler = async (flags, positional, ctx) => {
  const action = positional[0] || "list";

  if (action === "audit") return positional[1] === "position-sizer"
    ? auditPositionCommand(flags, ctx.commandSignal) : auditMacroCommand(flags, ctx.commandSignal);

  if (action === "install") {
    const repo = positional[1] || String(flags.repo || "");
    if (!repo) {
      return {
        success: false,
        message: [
          "Use /skill install <owner/repo>",
          "",
          "Examples",
          "  /skill install LLMQuant/skills",
          "  /skill install tradermonty/claude-trading-skills",
        ].join("\n"),
      };
    }
    return installSkills(repo, ctx.commandSignal);
  }

  let skills = await loadSkillsFromContext(ctx);

  if (action === "info") {
    const name = positional[1] || String(flags.name || flags.skill || "");
    if (!name) return { success: false, message: "Choose a skill with /skill info <name>." };
    let skill = skills.find((entry) => entry.name === name);
    if (!skill) return { success: false, message: `Unknown skill "${name}". Run /skill to list available skills.` };
    const curated = curatedSkillInfo(skill.filePath);
    const networkRequirement = curated?.modes.flatMap(mode => mode.requires)
      .find(requirement => requirement === BREADTH_NETWORK_REQUIREMENT || requirement === ETF_NETWORK_REQUIREMENT);
    if (flags["check-network"] !== undefined && (flags["check-network"] !== true || !networkRequirement)) {
      return { success: false, message: "--check-network supports only curated market-breadth-analyzer or macro-regime-detector inputs and takes no value." };
    }
    const needsPython = curated?.modes.some(mode => mode.requires.some(requirement => requirement.startsWith("python"))) ?? false;
    if (flags.check && curated && (needsPython || curated.reviewedFiles)) {
      if (needsPython) await checkSkillPython(process.cwd(), ctx.commandSignal);
      if (curated.reviewedFiles) checkSkillFiles(process.cwd(), skill.filePath, curated.reviewedFiles, ctx.commandSignal);
      skills = await loadSkillsFromContext(ctx);
      skill = skills.find(entry => entry.name === name);
      if (!skill) return { success: false, message: `Skill ${name} is no longer discovered.` };
    }
    if (flags["check-network"]) {
      if (networkRequirement === ETF_NETWORK_REQUIREMENT) await checkEtfNetwork(process.cwd(), ctx.commandSignal);
      else await checkSkillNetwork(process.cwd(), ctx.commandSignal);
      skills = await loadSkillsFromContext(ctx);
      skill = skills.find(entry => entry.name === name);
      if (!skill) return { success: false, message: `Skill ${name} is no longer discovered.` };
    }
    return {
      success: true,
      message: [
        skill.name,
        `Source      ${sourceLabel(skill)}`,
        `Visible     ${skill.readiness?.status === "blocked" || skill.readiness?.status === "unverified" ? "discovery only; invocation unavailable" : skill.disableModelInvocation ? "explicit only" : "model + explicit"}`,
        `Location    ${skill.filePath}`,
        `Summary     ${skill.description}`,
        ...(skill.readiness ? [
          `Readiness   ${skill.readiness.status}${skill.readiness.checkedAt ? ` · local check ${skill.readiness.checkedAt}` : ""}`,
          ...skill.readiness.modes.flatMap(mode => [`  ${mode.name}: ${mode.status}`, ...mode.requirements.map(item => `    ${item.requirement}: ${item.status} — ${item.reason}`)]),
          "Check declared local dependencies with /skill info <name> --check. Local metadata and file matches do not verify network access or workflow results.",
          ...(curated?.reviewedFiles ? ["--check also compares the installed entry and reviewed local files; recheck after edits or upgrades."] : []),
          ...(networkRequirement === BREADTH_NETWORK_REQUIREMENT ? ["Use --check-network to check the fixed public CSV inputs; results expire after five minutes."] : []),
          ...(networkRequirement === ETF_NETWORK_REQUIREMENT ? ["Use --check-network to check the nine public ETF histories; results expire after five minutes."] : []),
          ...(skill.name === "macro-regime-detector" ? ["Audit one report with /skill audit macro-regime-detector --json REPORT.json --markdown REPORT.md; a pinned verification bundle uses --record PATH."] : []),
          ...(skill.name === "position-sizer" ? ["Audit a selected private report locally with /skill audit position-sizer --json REPORT.json --markdown REPORT.md; values and paths are omitted from the receipt."] : []),
        ] : []),
        ...(curated ? [
          `Catalog pin ${curated.expectedRevision} (installed revision not checked here)`,
          "Requirements by mode (declared, not verified)",
          ...curated.modes.map(mode => `  ${mode.name}: ${mode.requires.join(", ")}${mode.optional.length ? `; optional: ${mode.optional.join(", ")}` : ""}`),
          `Limits      ${curated.limitations}`,
        ] : []),
      ].join("\n"),
      data: curated ? { ...skill, curated } : skill,
    };
  }

  if (action === "run" || action === "trigger") {
    const name = positional[1] || String(flags.name || flags.skill || "");
    if (!name) return { success: false, message: "Choose a skill with /skill:<name> or /skill run <name> [instructions]." };
    const extra = positional.slice(2).join(" ").trim() || undefined;
    if (!ctx.agentSession) return { success: false, message: "Running a skill needs an active agent session. Send any AI message first, then try again." };
    await ctx.agentSession.skill(name, extra);
    return {
      success: true,
      message: `Running ${name}${extra ? " with extra instructions." : "."}`,
    };
  }

  // Direct invocation: /skill:name [extra instructions]
  if (!SUBCOMMANDS.has(action)) {
    const name = action;
    const skill = skills.find((entry) => entry.name === name);
    if (!skill) return { success: false, message: `Unknown skill "${name}". Run /skill to list available skills.` };
    const extra = positional.slice(1).join(" ").trim() || undefined;
    if (!ctx.agentSession) return { success: false, message: "Running a skill needs an active agent session. Send any AI message first, then try again." };
    await ctx.agentSession.skill(name, extra);
    return {
      success: true,
      message: `Running ${name}${extra ? " with extra instructions." : "."}`,
    };
  }

  const filter = String(flags.scope || flags.source || "");
  const filtered = filter
    ? skills.filter((skill) => sourceLabel(skill).includes(filter) || skill.source === filter || skill.scope === filter)
    : skills;
  if (filtered.length === 0) {
    return {
      success: true,
      message: [
        "No skills found.",
        "",
        "Install skills:",
        "  /skill install LLMQuant/skills",
        "  /skill install tradermonty/claude-trading-skills",
      ].join("\n"),
    };
  }

  const lines = [
    `Skills (${filtered.length})`,
    ...filtered.map((skill) => `${skill.name.padEnd(24)} ${sourceLabel(skill).padEnd(12)} ${skill.readiness ? `[${skill.readiness.status}] ` : ""}${skill.description}`),
    "",
    "Use /skill info <name> for details",
    "Use /skill:<name> to invoke one",
    "Use /skill audit to check a macro or position-sizing report without running its skill",
    "Use /skill install <owner/repo> to install more",
  ];
  return { success: true, message: lines.join("\n"), data: filtered };
};
