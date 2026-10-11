import type { DataMarket, DataReadinessStatus, PythonReadiness } from "./data-readiness.ts";
import type { ToolProvider } from "./tool-capabilities.ts";

export interface ToolProbeRequest {
  tool: string;
  provider: ToolProvider;
  endpoint: string;
  market: DataMarket;
  params: Record<string, string | number | boolean>;
}
export interface ToolProbeResult extends ToolProbeRequest {
  status: DataReadinessStatus;
  rowCount: number;
  observedAt: string;
  durationMs: number;
  dependency?: PythonReadiness;
  detail: string;
  action: string;
  /** Only response access for this request; never a tool execution or freshness claim. */
  scope: "endpoint-response";
}
