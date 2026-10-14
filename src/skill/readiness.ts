import type { CuratedSkillMode } from "./catalog.ts";
import type { SkillPythonEvidence } from "./python-probe.ts";
import type { SkillReadiness, SkillRequirementCheck } from "../types/skills.ts";

/** Host facts are supplied explicitly. Missing evidence never becomes a ready capability. */
export function inspectSkillReadiness(modes: readonly CuratedSkillMode[], capabilities: Record<string, SkillRequirementCheck>, python?: SkillPythonEvidence): SkillReadiness {
  const checkedModes = modes.map(mode => {
    const requirements = mode.requires.map(requirement => {
      if (capabilities[requirement]) return { ...capabilities[requirement]!, requirement };
      if (/^(?:user-|crowd-direction$|weekly-price-source$)/.test(requirement)) return { requirement, status: "input-required" as const, reason: "Provide task-specific input; no values are inferred from private files." };
      if (!requirement.startsWith("python")) return { requirement, status: "unverified" as const, reason: "No scoped runtime evidence for this requirement." };
      if (!python) return { requirement, status: "unverified" as const, reason: "Run /skill info <name> --check to inspect the local Python environment." };
      if (python.status === "missing-python") return { requirement, status: "missing" as const, reason: "No Python interpreter was found by the configured selection rules." };
      if (python.status !== "observed") return { requirement, status: "unverified" as const, reason: python.reason ?? "Python check failed; retry the local check." };
      const match = /^(?:python(?::([a-z-]+))?)(?:(>=|==)(\d+(?:\.\d+)*))?$/.exec(requirement);
      if (!match) return { requirement, status: "unverified" as const, reason: "Unsupported version requirement." };
      const version = match[1] ? python.packages[match[1]] : python.python;
      if (version === null) return { requirement, status: "missing" as const, reason: `Package ${match[1]} is not installed in ${python.executable}.` };
      if (!version || !/^\d+(?:\.\d+)*$/.test(version)) return { requirement, status: "unverified" as const, reason: `Version ${version ?? "unknown"} needs explicit validation.` };
      const actual = version.split(".").map(Number), expected = (match[3] ?? "0").split(".").map(Number);
      const difference = Array.from({ length: Math.max(actual.length, expected.length) }, (_, index) => (actual[index] ?? 0) - (expected[index] ?? 0)).find(value => value !== 0) ?? 0;
      const meets = match[2] === "==" ? difference === 0 : difference >= 0;
      if (meets && match[1]) {
        const imported = python.imports?.[match[1]];
        if (!imported) return { requirement, status: "unverified" as const,
          reason: `${version} is installed in ${python.executable}; run /skill info <name> --check-imports to verify package loading.` };
        if (imported.status === "missing") return { requirement, status: "missing" as const,
          reason: `${match[1]} failed to import (${imported.error ?? "ImportFailure"}) in ${python.executable}.` };
      }
      return { requirement, status: meets ? "available" as const : "missing" as const, reason: `${version} in ${python.executable}; ${meets ? "installed version meets requirement; execution not tested" : "version requirement not met"}.` };
    });
    const status: SkillReadiness["status"] = requirements.some(item => item.status === "missing") ? "blocked"
      : requirements.some(item => item.status === "unverified") ? "unverified"
        : requirements.some(item => item.status === "input-required") ? "needs-input" : "requirements-met";
    return { name: mode.name, status, requirements };
  });
  const status = (["requirements-met", "needs-input", "unverified", "blocked"] as const).find(status => checkedModes.some(mode => mode.status === status)) ?? "unverified";
  return { status, modes: checkedModes, ...(python ? { checkedAt: python.checkedAt } : {}) };
}
