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
}

export interface DoctorResult {
  ready: boolean;
  mode: DoctorMode;
  overall: DoctorOverall;
  phases: [DoctorPhase, DoctorPhase, DoctorPhase];
  auth: Record<string, { available: boolean; source: AuthSource; value: string }>;
  config: {
    settingsPath: string;
    model: string;
    baseUrl: string;
    endpointMode: string;
    dataSource: string;
  };
  hints: string[];
  logPath?: string;
}

export function describeEndpointMode(baseUrl: string): string {
  const url = baseUrl.toLowerCase();
  if (url.includes("anthropic") || url.includes("claude")) return "Anthropic Messages";
  if (url.includes("openai") || url.includes("chat/completions") || url.endsWith("/v1")) return "OpenAI Compatible";
  if (url.includes("deepseek")) return "DeepSeek API";
  if (url.includes("localhost") || url.includes("127.0.0.1")) return "Local";
  if (url.includes("openrouter")) return "OpenRouter";
  return "Custom";
}
