import { resolve } from "node:path";
import type { SkillPythonRunner } from "./python-port.ts";
import type { SkillRequirementCheck } from "../types/skills.ts";
import { BREADTH_NETWORK_SCRIPT } from "./breadth-network-script.ts";

export const BREADTH_NETWORK_REQUIREMENT = "network:tradermonty-breadth-csv";
export interface SkillNetworkEvidence {
  available: boolean;
  checkedAt: string;
  expiresAt: string;
  reason: string;
  executable?: string;
  latestDate?: string;
  detailRows?: number;
  summaryRows?: number;
}
const observations = new Map<string, SkillNetworkEvidence>();
const requests = new Map<string, number>();
const revisions = new Map<string, number>();
const URL_ROOT = "https://tradermonty.github.io/market-breadth-analysis/";

export function skillNetworkRevision(cwd: string): string {
  const key = resolve(cwd), evidence = observations.get(key);
  return `${revisions.get(key) ?? 0}:${evidence ? Date.now() < Date.parse(evidence.expiresAt) : false}`;
}

export function readSkillNetwork(cwd: string, executable?: string, now = Date.now()): SkillRequirementCheck {
  const evidence = observations.get(resolve(cwd));
  const requirement = BREADTH_NETWORK_REQUIREMENT;
  if (!evidence) return { requirement, status: "unverified", reason: "Run /skill info market-breadth-analyzer --check-network to inspect the public CSV inputs." };
  if (now >= Date.parse(evidence.expiresAt) || !executable || evidence.executable !== executable) {
    return { requirement, status: "unverified", reason: `${evidence.reason}; network observation expired or Python interpreter is not matched; repeat --check and --check-network.` };
  }
  return { requirement, status: evidence.available ? "available" : "missing",
    reason: `${evidence.reason}; checked ${evidence.checkedAt}; expires ${evidence.expiresAt}${evidence.latestDate ? `; data ${evidence.latestDate}` : ""}. Fixed public inputs only; script execution and output quality are not certified.` };
}

/** Explicit, bounded network check; only aggregate evidence lives in process memory. */
export async function checkSkillNetwork(cwd: string, signal: AbortSignal | undefined, run: SkillPythonRunner): Promise<SkillNetworkEvidence> {
  signal?.throwIfAborted();
  const key = resolve(cwd), request = (requests.get(key) ?? 0) + 1;
  requests.set(key, request);
  let observed: Omit<SkillNetworkEvidence, "checkedAt" | "expiresAt">;
  try {
    const { stdout } = await run(BREADTH_NETWORK_SCRIPT, [`${URL_ROOT}market_breadth_data.csv`, `${URL_ROOT}market_breadth_summary.csv`, new Date().toISOString().slice(0, 10)], { timeoutMs: 20_000, signal });
    signal?.throwIfAborted();
    const value = JSON.parse(stdout) as Record<string, unknown>;
    if (!value || typeof value !== "object" || typeof value.ok !== "boolean" || typeof value.executable !== "string"
      || typeof value.reason !== "string" || !/^(observed|dependency|network|invalid-csv|invalid-summary|stale-data|future-data|response-too-large|http-\d{3})$/.test(value.reason)) throw new Error("Invalid probe result");
    if (value.ok && (value.reason !== "observed" || typeof value.latestDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.latestDate)
      || !Number.isSafeInteger(value.detailRows) || Number(value.detailRows) < 1 || !Number.isSafeInteger(value.summaryRows) || Number(value.summaryRows) < 1)) throw new Error("Incomplete probe result");
    observed = { available: value.ok, executable: value.executable, reason: value.reason,
      ...(typeof value.latestDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.latestDate) ? { latestDate: value.latestDate } : {}),
      ...(Number.isSafeInteger(value.detailRows) && Number(value.detailRows) > 0 ? { detailRows: Number(value.detailRows) } : {}),
      ...(Number.isSafeInteger(value.summaryRows) && Number(value.summaryRows) > 0 ? { summaryRows: Number(value.summaryRows) } : {}) };
  } catch {
    signal?.throwIfAborted();
    observed = { available: false, reason: "Network check unavailable; interpreter startup, timeout or invalid probe response." };
  }
  const now = Date.now(), evidence = { ...observed, checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 5 * 60_000).toISOString() };
  if (requests.get(key) === request) {
    observations.set(key, evidence);
    revisions.set(key, (revisions.get(key) ?? 0) + 1);
  }
  return structuredClone(evidence);
}
