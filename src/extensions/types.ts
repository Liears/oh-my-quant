import type { AgentTool, Skill } from "../agent/src/session-runtime/index.ts";
import type { SkillRequirementCheck } from "../types/skills.ts";

export const EXTENSION_API_VERSION = 1;

export interface ExtensionManifest {
  id: string;
  version: string;
  apiVersion: number;
  tools: string[];
  skills: string[];
  commands: string[];
  /** Additive API 1 field: trusted capability facts available to custom host policies. */
  capabilities?: string[];
}

export interface ExtensionContext {
  apiVersion: number;
  cwd: string;
  signal: AbortSignal;
  report(message: string): void;
}

export interface ExtensionCommand {
  name: string;
  description: string;
  execute(args: string[], signal: AbortSignal): Promise<unknown>;
}

export interface ExtensionResources {
  tools: AgentTool[];
  skills: Skill[];
  commands: ExtensionCommand[];
  capabilities?: SkillRequirementCheck[];
  dispose?(): Promise<void> | void;
}

export interface ExtensionDefinition {
  manifest: ExtensionManifest;
  activate(context: ExtensionContext): Promise<ExtensionResources> | ExtensionResources;
}

export interface ExtensionStatus {
  manifest: ExtensionManifest;
  enabled: boolean;
  diagnostics: string[];
}

export interface ExtensionSnapshot {
  revision: string;
  tools: AgentTool[];
  skills: Array<Skill & { extensionId: string }>;
  commands: Array<{ name: string; description: string; extensionId: string }>;
  capabilities: Array<SkillRequirementCheck & { extensionId: string }>;
}

export type ExtensionResourceKind = "tools" | "skills" | "commands" | "capabilities";
