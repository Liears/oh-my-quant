import { Type } from "typebox";
import type { ExtensionDefinition } from "../../index.ts";
import type { SkillRequirementCheck } from "../../../types/skills.ts";

/** Independent module: no TUI, storage, provider, runtime or builtin registry imports. */
export function statisticsExtension(options: { id?: string; version?: string; offset?: number; execute?: (signal: AbortSignal) => Promise<void>;
  capabilities?: SkillRequirementCheck[]; dispose?: () => Promise<void> | void } = {}): ExtensionDefinition {
  const schema = Type.Object({ values: Type.Array(Type.Number(), { minItems: 1 }) });
  const capabilities: SkillRequirementCheck[] = structuredClone(options.capabilities ?? [{ requirement: "statistics-observations", status: "available",
    reason: "fixture_mean accepts explicit numeric observations.", requiresTools: ["fixture_mean"] }]);
  return {
    manifest: { id: options.id ?? "fixture.statistics", version: options.version ?? "1.0.0", apiVersion: 1, tools: ["fixture_mean"], skills: ["fixture-statistics"], commands: ["fixture-echo"],
      capabilities: capabilities.map(capability => capability.requirement) },
    activate: context => ({
      tools: [{ name: "fixture_mean", label: "Fixture mean", description: "Compute mean from supplied observations", parameters: schema,
        async execute(_id, args, signal) {
          const active = signal ?? context.signal;
          await options.execute?.(active); active.throwIfAborted();
          const values = (args as { values: number[] }).values;
          const value = values.reduce((sum, item) => sum + item, 0) / values.length + (options.offset ?? 0);
          return { content: [{ type: "text", text: `Extension mean: ${value}` }], details: { value, version: options.version ?? "1.0.0" } };
        },
      }],
      skills: [{ name: "fixture-statistics", description: "Analyze explicit observations with fixture_mean", filePath: "extension://fixture.statistics/SKILL.md", content: "Use fixture_mean on the supplied observations. Keep missing input explicit." }],
      commands: [{ name: "fixture-echo", description: "Echo explicitly supplied command arguments", async execute(args, signal) { signal.throwIfAborted(); return { args, version: options.version ?? "1.0.0" }; } }],
      capabilities,
      dispose: options.dispose,
    }),
  };
}
