import type { DataSource } from "./config.ts";

export type DataMarket = "A" | "US" | "HK" | "Fund";
export type DataReadinessStatus = "ready" | "missing-credential" | "missing-python" | "missing-package"
  | "auth-failed" | "permission-denied" | "blocked-runtime" | "empty" | "timeout" | "cancelled" | "unavailable" | "unsupported" | "invalid-input";
export interface DataProbeRequest {
  source: DataSource;
  market: DataMarket;
  symbol: string;
  start: string;
  end: string;
}
export interface PythonReadiness {
  status: "ready" | "missing-python" | "missing-package";
  python?: string;
  akshare?: string;
  /** Opt-in native JavaScript check; import readiness alone does not prove this engine works. */
  javascript?: { status: "ready" | "blocked" | "missing-package" | "unavailable"; winerror?: 4551 };
}
export interface DataReadiness extends DataProbeRequest {
  status: DataReadinessStatus;
  detail: string;
  action: string;
  credentialSource: "config" | "env" | "missing" | "not-required";
  rowCount: number;
  asOfDate: string | null;
  observedAt: string;
  durationMs: number;
  dependency?: PythonReadiness;
  /** Concrete successful daily-series route, distinct from the logical provider. */
  providerEndpoint?: string;
  /** A successful sample is evidence only for this daily-series request. */
  capability: "daily-bars" | "unit-nav";
}
