import { BUILTIN_TOOLS } from "../../tools/registry.ts";
import { curatedSkillInfo } from "./skill-store.ts";
import { inspectSkillReadiness } from "../../skill/index.ts";
import { readSkillPython } from "../../skill/index.ts";
import { BREADTH_NETWORK_REQUIREMENT, readSkillNetwork } from "../../skill/index.ts";
import { ETF_NETWORK_REQUIREMENT, readEtfNetwork } from "../../skill/index.ts";
import { SCRIPT_FILES_REQUIREMENT, readSkillFiles } from "../../skill/index.ts";
import type { CommandSkill } from "../../types/commands.ts";
import type { SkillReadiness, SkillRequirementCheck } from "../../types/skills.ts";

export interface RuntimeSkillReadinessSources {
  readReviewedFiles?: typeof readSkillFiles;
  /** Trusted host facts. The active tool list remains authoritative for shell and local-file access. */
  readCapabilities?: () => Readonly<Record<string, SkillRequirementCheck>>;
}

/** Shell access comes from active tools; model/image entry facts must come from the host. */
export function prepareRuntimeSkills<T extends CommandSkill>(skills: T[], tools: readonly { name: string }[] = BUILTIN_TOOLS,
  cwd = process.cwd(), sources: RuntimeSkillReadinessSources = {}): Array<T & { readiness?: SkillReadiness }> {
  const shell = tools.some(tool => tool.name === "bash");
  const capabilities: Record<string, SkillRequirementCheck> = Object.fromEntries([
    ["shell-execution", shell, "Requires the active bash tool; per-command execution may still fail."],
    ["local-resource-read", shell, "Relative resource files are read through the active bash tool."],
    ["web-search", false, "No web-search adapter is exposed by the default host; symbol search is not web search."],
    ["llmquant-research-data", false, "The daily-price adapter does not provide the LLMQuant research/workspace primitives."],
    ["model-image-input", false, "The host has not supplied a matching image-input entry and model capability."],
    ["private-output-authorization", false, "Real account values require a private output contract; current artifacts may persist them."],
  ].map(([requirement, available, reason]) => [String(requirement), { requirement: String(requirement), status: available ? "available" : "missing", reason: String(reason) }]));
  const python = readSkillPython(cwd);
  capabilities[BREADTH_NETWORK_REQUIREMENT] = readSkillNetwork(cwd, python?.executable);
  capabilities[ETF_NETWORK_REQUIREMENT] = readEtfNetwork(cwd, python?.executable);
  const activeTools = new Set(tools.map(tool => tool.name));
  for (const [requirement, check] of Object.entries(sources.readCapabilities?.() ?? {})) {
    if (requirement === "shell-execution" || requirement === "local-resource-read") continue;
    const missingTools = (check.requiresTools ?? []).filter(name => !activeTools.has(name));
    capabilities[requirement] = missingTools.length
      ? { ...check, requirement, status: "missing", reason: `Requires active tools: ${missingTools.join(", ")}. ${check.reason}` }
      : { ...check, requirement };
  }
  return skills.map(skill => {
    const curated = curatedSkillInfo(skill.filePath);
    if (!curated) return { ...skill };
    const local = { ...capabilities };
    if (curated.reviewedFiles) local[SCRIPT_FILES_REQUIREMENT] = (sources.readReviewedFiles ?? readSkillFiles)(cwd, skill.filePath, curated.reviewedFiles);
    if (curated.modes.some(mode => mode.requires.includes("network:fmp-eod"))) {
      local["FMP_API_KEY"] ??= { requirement: "FMP_API_KEY", status: "unverified", reason: "The upstream CLI requires --api-key or FMP_API_KEY. This check does not read credentials or verify their validity." };
      local["network:fmp-eod"] ??= { requirement: "network:fmp-eod", status: "unverified", reason: "Authenticated FMP daily OHLC access and symbol coverage are unverified; supplied prices do not satisfy this CLI requirement." };
    }
    const readiness = inspectSkillReadiness(curated.modes, local, python);
    return withReadiness(skill, readiness);
  });
}

/** Narrow capabilities using existing observations; never probe or refresh dependencies inside a tool loop. */
export function scopeRuntimeSkills<T extends CommandSkill & { readiness?: SkillReadiness }>(raw: T[], prepared: T[], tools: readonly string[]): T[] {
  return prepared.map(skill => {
    const original = raw.find(item => item.name === skill.name && item.filePath === skill.filePath);
    if (!original || !skill.readiness) return structuredClone(skill);
    const modes = skill.readiness.modes.map(mode => ({ name: mode.name, requires: mode.requirements.map(item => item.requirement), optional: [] }));
    const activeTools = new Set(tools);
    const capabilities = Object.fromEntries(skill.readiness.modes.flatMap(mode => mode.requirements).map(item => {
      const missingTools = (item.requiresTools ?? []).filter(name => !activeTools.has(name));
      return [item.requirement, (item.requirement === "shell-execution" || item.requirement === "local-resource-read") && !activeTools.has("bash")
        ? { ...item, status: "missing" as const, reason: "The current research task does not expose bash." }
        : missingTools.length ? { ...item, status: "missing" as const, reason: `The current research task does not expose required tools: ${missingTools.join(", ")}.` }
          : item];
    }));
    const readiness = { ...inspectSkillReadiness(modes, capabilities), checkedAt: skill.readiness.checkedAt };
    return withReadiness({ ...skill, description: original.description, disableModelInvocation: skill.disableModelInvocation || original.disableModelInvocation }, readiness);
  });
}

function withReadiness<T extends CommandSkill>(skill: T, readiness: SkillReadiness): T & { readiness: SkillReadiness } {
  const usable = readiness.modes.filter(mode => mode.status === "requirements-met" || mode.status === "needs-input");
  const curated = curatedSkillInfo(skill.filePath);
  const sourceNote = skill.name === "macro-regime-detector" && curated?.expectedRevision === "a2506fd1bab662723fb7142734320fef23fc48fa"
    ? " Pinned Markdown can mislabel yfinance-only prices as FMP API; check report JSON metadata and surface any mismatch before citing the source."
    : skill.name === "llmquant-risk" && curated?.expectedRevision === "1918237467c2dff4cc97a18ebc0892dfd46e8129"
      ? ` ${curated.limitations}`
    : "";
  return { ...skill, readiness, disableModelInvocation: skill.disableModelInvocation || usable.length === 0,
    description: `${skill.description} [${readiness.status}; permitted modes: ${usable.map(mode => mode.name).join(", ") || "none"}; inspect /skill info ${skill.name} for missing requirements.]${sourceNote}` };
}
