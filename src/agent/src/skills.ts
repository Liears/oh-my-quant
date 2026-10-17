import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { loadSkills, parseFrontmatter, type ResourceDiagnostic } from "./pi-skills.ts";
import type { Skill } from "./session-runtime/index.ts";
import type { NodeExecutionEnv } from "./session-runtime/node.ts";
import type { SkillIntegrationSettings } from "../../types/config.ts";
import { perfLog, perfNow } from "../../perf.ts";

export interface QuantSkill extends Skill {
  scope: "project" | "user";
  source: "agents" | "claude" | "codex" | "pi" | "extension";
  sourcePath: string;
}

export interface QuantSkillDiagnostic extends ResourceDiagnostic {
  scope: "project" | "user";
  source: "agents" | "claude" | "codex" | "pi";
  sourcePath: string;
}

interface SkillSource {
  path: string;
  scope: "project" | "user";
  source: "agents" | "claude" | "codex" | "pi";
}

export interface DiscoverSkillsOptions {
  cwd: string;
  env: NodeExecutionEnv;
  extraPaths?: string[];
  integrations?: Partial<SkillIntegrationSettings>;
}

type DiscoverSkillsResult = { skills: QuantSkill[]; diagnostics: QuantSkillDiagnostic[]; sources: SkillSource[] };

const discoveryCache = new Map<string, Promise<DiscoverSkillsResult>>();
let discoveryRevision = 0;

export function invalidateSkillDiscovery(): void {
  discoveryCache.clear();
  discoveryRevision++;
}

export function skillDiscoveryRevision(): number { return discoveryRevision; }

export async function discoverSkills(
  options: DiscoverSkillsOptions,
): Promise<DiscoverSkillsResult> {
  const sources = resolveSkillSources(options.cwd, options.extraPaths, options.integrations);
  const cacheKey = discoveryCacheKey(sources);
  if (process.env.WHYJ_SKILL_CACHE?.toLowerCase() !== "off") {
    const cached = discoveryCache.get(cacheKey);
    if (cached) {
      const startedAt = perfNow();
      const result = await cached;
      perfLog("skills.cache", startedAt, { skills: result.skills.length, sources: result.sources.length });
      return cloneDiscoveryResult(result);
    }
  }

  const startedAt = perfNow();
  const loading = loadDiscoveredSkills(sources)
    .then((result) => {
      perfLog("skills.load", startedAt, { skills: result.skills.length, sources: result.sources.length });
      return result;
    })
    .catch((error) => {
      if (discoveryCache.get(cacheKey) === loading) discoveryCache.delete(cacheKey);
      throw error;
    });
  if (process.env.WHYJ_SKILL_CACHE?.toLowerCase() !== "off") discoveryCache.set(cacheKey, loading);
  return cloneDiscoveryResult(await loading);
}

/** Pi owns traversal, frontmatter validation and ignore rules; JQ adds provenance and a session snapshot. */
async function loadDiscoveredSkills(sources: SkillSource[]): Promise<DiscoverSkillsResult> {
  const skills: QuantSkill[] = [], diagnostics: QuantSkillDiagnostic[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const loaded = loadSkills({ cwd: dirname(source.path), agentDir: homedir(), skillPaths: [source.path], includeDefaults: false });
    diagnostics.push(...loaded.diagnostics.map(item => ({ ...item, sourcePath: source.path, scope: source.scope, source: source.source })));
    for (const skill of loaded.skills) {
      if (seen.has(skill.name)) continue;
      const { body } = parseFrontmatter(readFileSync(skill.filePath, "utf8"));
      skills.push({ name: skill.name, description: skill.description, filePath: skill.filePath,
        content: body, disableModelInvocation: skill.disableModelInvocation,
        sourcePath: source.path, scope: source.scope, source: source.source });
      seen.add(skill.name);
    }
  }
  return { skills, diagnostics, sources };
}

function cloneDiscoveryResult(result: DiscoverSkillsResult): DiscoverSkillsResult {
  return {
    skills: result.skills.map((skill) => ({ ...skill })),
    diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    sources: result.sources.map((source) => ({ ...source })),
  };
}

function discoveryCacheKey(sources: SkillSource[]): string {
  return sources
    .map((source) => `${source.scope}:${source.source}:${resolve(source.path)}`)
    .join("|");
}

function resolveSkillSources(
  cwd: string,
  extraPaths: string[] = [],
  integrations: Partial<SkillIntegrationSettings> = {},
): SkillSource[] {
  const userHome = homedir();
  const homeRoot = resolve(userHome);
  const projectRoots = collectAncestorRoots(cwd).filter((root) => resolve(root) !== homeRoot);
  const userSources: SkillSource[] = [];
  if (integrations.external === true) {
    userSources.push(
      { path: join(userHome, ".claude", "skills"), scope: "user", source: "claude" },
      { path: join(userHome, ".agents", "skills"), scope: "user", source: "agents" },
      { path: join(userHome, ".pi", "agent", "skills"), scope: "user", source: "pi" },
      { path: join(userHome, ".codex", "skills"), scope: "user", source: "codex" },
    );
  }
  const candidates: SkillSource[] = [
    ...projectRoots.flatMap((root) => ([
      { path: join(root, ".agents", "skills"), scope: "project" as const, source: "agents" as const },
      { path: join(root, ".pi", "skills"), scope: "project" as const, source: "pi" as const },
    ])),
    ...userSources,
    ...extraPaths.map((path) => ({ path: resolve(path), scope: "project" as const, source: "pi" as const })),
  ];

  const seen = new Set<string>();
  const sources: SkillSource[] = [];
  for (const candidate of candidates) {
    const normalized = resolve(candidate.path);
    if (seen.has(normalized) || !existsSync(normalized)) continue;
    seen.add(normalized);
    sources.push({ ...candidate, path: normalized });
  }
  return sources;
}

function collectAncestorRoots(cwd: string): string[] {
  const roots: string[] = [];
  let current = resolve(cwd);
  while (true) {
    roots.push(current);
    if (existsSync(join(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}
