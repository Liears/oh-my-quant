import type { DataProbeRequest, DataReadiness, PythonReadiness } from "./data-readiness.ts";
import type { ToolReadiness } from "./tool-capabilities.ts";

export type PhaseStatus = "pending" | "checking" | "pass" | "fail";
export type DoctorMode = "diagnostic" | "first_setup";
export type DoctorOverall = "running" | "all_pass" | "partial_fail" | "unconfigured";
export type AuthSource = "env" | "config" | "missing";

export interface DoctorPhase {
  phase: "model" | "tools" | "data";
  status: PhaseStatus;
  label: string;
  detail: string;
  error?: string;
  action?: string;
  warnings?: string[];
  durationMs?: number;
  data?: DataReadiness;
  dependency?: PythonReadiness;
}

export interface DoctorResult {
  ready: boolean;
  mode: DoctorMode;
  overall: DoctorOverall;
  phases: [DoctorPhase, DoctorPhase, DoctorPhase];
  /** Phases requested in this run; untested phases remain pending. */
  requestedPhases?: DoctorPhase["phase"][];
  /** Per-tool dependencies and scoped sample evidence, not blanket execution readiness. */
  capabilities?: ToolReadiness[];
  auth: Record<string, { available: boolean; source: AuthSource; value: string }>;
  config: {
    settingsPath: string;
    model: string;
    provider?: string;
    baseUrl: string;
    endpointMode: string;
    dataSource: string;
    dataRequest?: DataProbeRequest;
  };
  hints: string[];
  logPath?: string;
}
