import { resolve } from "node:path";
import type { SkillPythonRunner } from "./python-port.ts";
import type { SkillRequirementCheck } from "../types/skills.ts";
import { ETF_NETWORK_SCRIPT } from "./etf-network-script.ts";

export const ETF_NETWORK_REQUIREMENT = "network:etf-history";
export interface EtfNetworkEvidence {
  available: boolean;
  checkedAt: string;
  expiresAt: string;
  reason: string;
  executable?: string;
  symbols?: number;
  minimumBars?: number;
  latestDate?: string;
  oldestDate?: string;
  failedSymbol?: string;
}
const observations = new Map<string, EtfNetworkEvidence>();
const requests = new Map<string, number>();
const revisions = new Map<string, number>();
const universe = new Set(["RSP", "SPY", "IWM", "TLT", "SHY", "HYG", "LQD", "XLY", "XLP"]);
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function skillEtfRevision(cwd: string): string {
  const key = resolve(cwd), evidence = observations.get(key);
  return `${revisions.get(key) ?? 0}:${evidence ? Date.now() < Date.parse(evidence.expiresAt) : false}`;
}

export function readEtfNetwork(cwd: string, executable?: string, now = Date.now()): SkillRequirementCheck {
  const evidence = observations.get(resolve(cwd)), requirement = ETF_NETWORK_REQUIREMENT;
  if (!evidence) return { requirement, status: "unverified", reason: "Run /skill info macro-regime-detector --check-network to inspect its nine ETF inputs." };
  if (now >= Date.parse(evidence.expiresAt) || !executable || evidence.executable !== executable) {
    return { requirement, status: "unverified", reason: `${evidence.reason}; network observation expired or Python interpreter is not matched; repeat --check and --check-network.` };
  }
  return { requirement, status: evidence.available ? "available" : "missing",
    reason: `${evidence.reason}${evidence.failedSymbol ? ` (${evidence.failedSymbol})` : ""}; checked ${evidence.checkedAt}; expires ${evidence.expiresAt}`
      + `${evidence.latestDate ? `; latest data ${evidence.latestDate}` : ""}${evidence.minimumBars ? `; minimum ${evidence.minimumBars} bars` : ""}. Public ETF inputs only; script execution and conclusions are not certified.` };
}

/** A manual, bounded observation of the exact public ETF universe; only aggregate facts are kept. */
export async function checkEtfNetwork(cwd: string, signal: AbortSignal | undefined, run: SkillPythonRunner): Promise<EtfNetworkEvidence> {
  signal?.throwIfAborted();
  const key = resolve(cwd), request = (requests.get(key) ?? 0) + 1;
  requests.set(key, request);
  let observed: Omit<EtfNetworkEvidence, "checkedAt" | "expiresAt">;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { stdout } = await run(ETF_NETWORK_SCRIPT, [today], { timeoutMs: 60_000, signal });
    signal?.throwIfAborted();
    const value = JSON.parse(stdout) as Record<string, unknown>;
    if (!value || typeof value !== "object" || typeof value.ok !== "boolean" || typeof value.executable !== "string"
      || typeof value.reason !== "string" || !/^(observed|dependency|network|missing-etf|short-history|stale-history|future-history|invalid-history)$/.test(value.reason)
      || !Number.isSafeInteger(value.symbols) || Number(value.symbols) < 0 || Number(value.symbols) > 9
      || (value.failedSymbol !== undefined && (typeof value.failedSymbol !== "string" || !universe.has(value.failedSymbol)))) throw new Error("Invalid ETF probe result.");
    if (value.ok && (value.reason !== "observed" || value.symbols !== 9 || !Number.isSafeInteger(value.minimumBars) || Number(value.minimumBars) < 400
      || !validDate(value.latestDate) || !validDate(value.oldestDate) || Date.parse(value.latestDate) - Date.parse(value.oldestDate) < 500 * 86_400_000
      || Date.parse(value.latestDate) > Date.parse(today) || Date.parse(today) - Date.parse(value.latestDate) > 5 * 86_400_000)) {
      throw new Error("Incomplete ETF probe result.");
    }
    observed = { available: value.ok, executable: value.executable, reason: value.reason, symbols: Number(value.symbols),
      ...(value.failedSymbol ? { failedSymbol: value.failedSymbol as string } : {}),
      ...(validDate(value.latestDate) ? { latestDate: value.latestDate } : {}),
      ...(validDate(value.oldestDate) ? { oldestDate: value.oldestDate } : {}),
      ...(Number.isSafeInteger(value.minimumBars) && Number(value.minimumBars) > 0 ? { minimumBars: Number(value.minimumBars) } : {}) };
  } catch {
    signal?.throwIfAborted();
    observed = { available: false, reason: "ETF network check unavailable; interpreter startup, timeout or invalid probe response." };
  }
  const now = Date.now(), evidence = { ...observed, checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 5 * 60_000).toISOString() };
  if (requests.get(key) === request) {
    observations.set(key, evidence);
    revisions.set(key, (revisions.get(key) ?? 0) + 1);
  }
  return structuredClone(evidence);
}
