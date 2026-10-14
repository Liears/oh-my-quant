import type { ExtensionHost } from "../extensions/index.ts";
import type { QuantAgentDependencies } from "../agent/src/session-contracts.ts";
import type { SkillRequirementCheck } from "../types/skills.ts";

function combineCapabilities(base: QuantAgentDependencies, capabilities: ReadonlyArray<SkillRequirementCheck & { extensionId: string }>): Readonly<Record<string, SkillRequirementCheck>> {
  const combined: Record<string, SkillRequirementCheck> = structuredClone(base.readSkillCapabilities?.() ?? {});
  for (const { extensionId, ...capability } of capabilities) {
    if (Object.hasOwn(combined, capability.requirement)) throw new Error(`Skill capability conflict: ${capability.requirement} is already supplied outside extension ${extensionId}`);
    combined[capability.requirement] = capability;
  }
  return combined;
}

/** The host is the complete tool registry; load the built-in extension when those tools are wanted. */
export async function extensionSessionDependencies(base: QuantAgentDependencies, host: ExtensionHost): Promise<QuantAgentDependencies> {
  await host.reserve({ tools: ["research_task"], capabilities: Object.keys(base.readSkillCapabilities?.() ?? {}) });
  return { ...base, tools: host.snapshot().tools,
    readSkillRevision: () => JSON.stringify([base.readSkillRevision?.() ?? "", host.snapshot().revision]),
    readSkillCapabilities: () => combineCapabilities(base, host.snapshot().capabilities),
    readTools() {
      const snapshot = host.snapshot();
      return { revision: snapshot.revision, tools: snapshot.tools,
        skills: snapshot.skills.map(({ extensionId, ...skill }) => ({ ...skill, source: "extension" as const, scope: "project" as const, sourcePath: `extension://${extensionId}` })),
        capabilities: combineCapabilities(base, snapshot.capabilities),
      };
    },
  };
}
