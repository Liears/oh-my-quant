import type { OhQuantSettings } from "../types/config.ts";
import { describeEndpointMode } from "../runtime/doctor-contract.ts";
import type { DoctorMode, DoctorOverall, DoctorPhase, DoctorResult } from "../runtime/doctor-contract.ts";
import { resolveOhquantDir, resolveSettingsPath } from "../storage/index.ts";
import { resolveModelId } from "../agent/src/session.ts";
import { Compile } from "typebox/compile";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export { describeEndpointMode };
export type { AuthSource, DoctorMode, DoctorOverall, DoctorPhase, DoctorResult, PhaseStatus } from "../runtime/doctor-contract.ts";

export interface DoctorOptions {
  now?: () => number;
  probeTimeoutMs?: number;
  skipNetwork?: boolean;
  writeLog?: boolean;
  onState?: (state: DoctorResult) => void;
  modelProbe?: DoctorProbe;
  dataProbe?: DoctorProbe;
  phases?: DoctorPhase["phase"][];
  seedState?: DoctorResult;
}

export interface DoctorProbeContext {
  state: DoctorResult;
  settings: OhQuantSettings;
  processEnv: Record<string, string | undefined>;
  timeoutMs: number;
}

export interface DoctorProbeResult {
  ok: boolean;
  detail: string;
  raw?: unknown;
}

export type DoctorProbe = (ctx: DoctorProbeContext) => Promise<DoctorProbeResult>;

const AUTH_KEYS = [
  "WHYJ_QUANT_API_KEY",
  "WHYJ_QUANT_AUTH_TOKEN",
  "WHYJ_QUANT_BASE_URL",
  "WHYJ_QUANT_TUSHARE_TOKEN",
  "WHYJ_QUANT_LLMQUANT_API_KEY",
  "WHYJ_QUANT_FINANCIAL_DATASETS_KEY",
] as const;

type AuthKey = typeof AUTH_KEYS[number];
const PHASE_ORDER: DoctorPhase["phase"][] = ["model", "tools", "data"];

export async function* runDoctor(
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
  options: DoctorOptions = {},
): AsyncIterable<DoctorResult> {
  const effectiveOptions = withEnvOptions(options, processEnv);
  const initial = createInitialState(settings, processEnv);
  const reusableSeed = isReusableSeedState(effectiveOptions.seedState, initial)
    ? effectiveOptions.seedState
    : undefined;
  const requestedPhases = reusableSeed
    ? normalizeRequestedPhases(effectiveOptions.phases)
    : [...PHASE_ORDER];
  let state = createRunState(initial, reusableSeed, requestedPhases);
  const phaseChecks: Record<DoctorPhase["phase"], (state: DoctorResult) => Promise<DoctorPhase>> = {
    model: (current) => checkModelPhase(current, settings, processEnv, effectiveOptions),
    tools: (current) => checkToolsPhase(current, settings, effectiveOptions),
    data: (current) => checkDataPhase(current, settings, processEnv, effectiveOptions),
  };

  for (const phaseName of requestedPhases) {
    const index = PHASE_ORDER.indexOf(phaseName);
    if (index < 0) continue;
    state = markPhaseChecking(state, index, effectiveOptions);
    yield state;
    const checked = await phaseChecks[phaseName](state);
    state = replacePhase(state, index, checked);
    yield state;
  }
}

export async function collectDoctor(
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
  options: DoctorOptions = {},
): Promise<DoctorResult> {
  const effectiveOptions = withEnvOptions(options, processEnv);
  let last: DoctorResult | null = null;
  for await (const state of runDoctor(settings, processEnv, effectiveOptions)) {
    effectiveOptions.onState?.(state);
    last = state;
  }
  const final = last ?? finalizeState(createInitialState(settings, processEnv));
  return effectiveOptions.writeLog === false ? final : writeDoctorLog(final, effectiveOptions);
}

export function formatDoctorText(doctor: DoctorResult): string {
  const phaseRows = doctor.phases.map((phase) => [
    phase.phase,
    phase.status === "pass" ? "pass" : phase.status === "fail" ? "fail" : phase.status,
    compactText([
      phase.error || phase.detail || "-",
      ...(phase.warnings ?? []),
    ].filter(Boolean).join(" · ")),
    compactText(phase.action || "-"),
  ]);
  const credentialRows = AUTH_KEYS.map((key) => {
    const entry = doctor.auth[key];
    return [
      key,
      entry?.available ? "OK" : "missing",
      entry?.source ?? "missing",
      entry?.value ?? "-",
    ];
  });

  const lines: string[] = [
    "WhyJ Doctor",
    "",
    `  status        ${doctor.overall}`,
    `  command        whyj doctor`,
    `  mode           ${doctor.mode}`,
    `  model          ${doctor.config.model}`,
    doctor.config.baseUrl
      ? `  base url       ${doctor.config.baseUrl} · ${doctor.config.endpointMode}`
      : "  base url       (not set)",
    `  data source    ${doctor.config.dataSource}`,
    `  settings       ${doctor.config.settingsPath}`,
    "",
    "Phases",
    ...buildAlignedTable(["phase", "status", "detail", "action"], phaseRows).map((line) => `  ${line}`),
    "",
    "Credentials",
    ...buildAlignedTable(["key", "status", "source", "value"], credentialRows).map((line) => `  ${line}`),
    "",
    "Hints",
  ];

  if (doctor.hints.length === 0) {
    lines.push("- All checks passed.");
  } else {
    for (const hint of doctor.hints) lines.push(`- ${hint}`);
  }
  if (doctor.logPath) {
    lines.push("", `Logs  ·  ${doctor.logPath}`);
  }

  return lines.join("\n");
}

export function formatDoctorFirstSetupText(doctor: DoctorResult): string {
  const source = doctor.config.dataSource;
  const tokenKey = sourceTokenEnvKey(source);
  const envBlock = [
    '  "WHYJ_QUANT_API_KEY": "sk-your-key-here",',
    '  "WHYJ_QUANT_BASE_URL": "https://api.deepseek.com/anthropic",',
    tokenKey
      ? `  "${tokenKey}": "your-${source.replace(/[^a-z0-9]+/gi, "-")}-key"`
      : undefined,
  ].filter(Boolean).join("\n");
  return [
    "No credentials configured.",
    "",
    "Add this to .ohquant/settings.json:",
    "",
    "{",
    '  "env": {',
    envBlock,
    "  }",
    "}",
    "",
    "Then: whyj doctor",
  ].join("\n");
}

export function buildDoctorErrorResult(
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
  error: unknown,
  requestedPhases?: DoctorPhase["phase"][],
): DoctorResult {
  const initial = createInitialState(settings, processEnv);
  const phases = [...initial.phases] as DoctorResult["phases"];
  const targetPhases = normalizeRequestedPhases(requestedPhases);
  const target = targetPhases[0] ?? "model";
  const targetIndex = PHASE_ORDER.indexOf(target);
  if (targetIndex >= 0) {
    phases[targetIndex] = {
      phase: target,
      status: "fail",
      label: titleCase(target),
      detail: `Doctor runtime error: ${errorMessage(error)}`,
      error: `Doctor runtime error: ${errorMessage(error)}`,
      action: "Check settings, log path permissions, and provider configuration, then retry doctor.",
      durationMs: 0,
    };
  }
  return {
    ...initial,
    phases,
    overall: "partial_fail",
    hints: ["Check settings, log path permissions, and provider configuration, then retry doctor."],
  };
}

export function formatDoctorProgressLine(state: DoctorResult): string {
  const active = [...state.phases].reverse().find((phase) => phase.status !== "pending") ?? state.phases[0];
  const status = active.status === "checking" ? "[....]" : active.status === "pass" ? "[ OK ]" : active.status === "fail" ? "[FAIL]" : "[    ]";
  const label = titleCase(active.phase).padEnd(5);
  return `${status} ${label} · ${active.error || active.detail || active.label}`;
}

function createInitialState(
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
): DoctorResult {
  const auth = resolveAuth(settings, processEnv);
  const dataSource = settings.preferences?.source ?? "llmquant-data";
  const baseUrl = resolvedValue(settings, processEnv, "WHYJ_QUANT_BASE_URL");
  const modelEnv: Record<string, string> = {
    ...settings.env,
    ...definedStringEnv(processEnv),
  };
  const resolvedModel = stripAnsi(resolveModelId(settings.model || "sonnet", modelEnv));
  const hasModelCredential = (auth.WHYJ_QUANT_API_KEY?.available ?? false)
    || (auth.WHYJ_QUANT_AUTH_TOKEN?.available ?? false);
  const sourceTokenKey = sourceTokenEnvKey(dataSource);
  const hasSourceToken = dataSource === "akshare"
    || (sourceTokenKey ? (auth[sourceTokenKey]?.available ?? false) : false);
  const mode: DoctorMode = !hasModelCredential && !hasSourceToken ? "first_setup" : "diagnostic";

  return finalizeState({
    ready: true,
    mode,
    overall: "running",
    phases: [
      pendingPhase("model", "Model"),
      pendingPhase("tools", "Tools"),
      pendingPhase("data", "Data"),
    ],
    auth,
    config: {
      settingsPath: resolveSettingsPath(),
      model: resolvedModel,
      baseUrl,
      endpointMode: baseUrl ? describeEndpointMode(baseUrl) : "",
      dataSource,
    },
    hints: [],
  });
}

function createRunState(
  initial: DoctorResult,
  seedState: DoctorResult | undefined,
  requestedPhases: DoctorPhase["phase"][],
): DoctorResult {
  if (!seedState) return initial;

  const next = cloneState(initial);
  for (const phaseName of PHASE_ORDER) {
    const index = PHASE_ORDER.indexOf(phaseName);
    const previous = seedState.phases[index];
    if (!previous) continue;
    next.phases[index] = requestedPhases.includes(phaseName)
      ? pendingPhase(phaseName, previous.label || titleCase(phaseName))
      : { ...previous, warnings: previous.warnings ? [...previous.warnings] : undefined };
  }
  return finalizeState(next);
}

function resolveAuth(
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
): DoctorResult["auth"] {
  const env = settings.env ?? {};
  const auth: DoctorResult["auth"] = {};

  for (const key of AUTH_KEYS) {
    const fromEnv = typeof processEnv[key] === "string" && processEnv[key]!.trim();
    const fromConfig = typeof env[key] === "string" && env[key].trim();
    if (fromEnv) {
      auth[key] = { available: true, source: "env", value: redact(fromEnv as string) };
    } else if (fromConfig) {
      auth[key] = { available: true, source: "config", value: redact(fromConfig as string) };
    } else {
      auth[key] = { available: false, source: "missing", value: "-" };
    }
  }

  return auth;
}

async function checkModelPhase(
  state: DoctorResult,
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
  options: DoctorOptions,
): Promise<DoctorPhase> {
  const start = timestamp(options);
  const modelCredential = resolveModelCredential(state);
  const hasModelCredential = Boolean(modelCredential);
  const hasBaseUrl = state.auth.WHYJ_QUANT_BASE_URL?.available ?? false;
  if (!hasModelCredential) {
    return failPhase("model", "Model", "Missing WHYJ_QUANT_API_KEY", "Open /doctor Configure and set WHYJ_QUANT_API_KEY.", start, options);
  }
  if (!hasBaseUrl) {
    return failPhase("model", "Model", "Missing WHYJ_QUANT_BASE_URL", "Open /doctor Configure and set WHYJ_QUANT_BASE_URL.", start, options);
  }

  if (options.skipNetwork) {
    return passPhase(
      "model",
      `Model · ${state.config.model}`,
      `${modelCredential!.entry.value} · ${state.config.endpointMode}`,
      start,
      options,
      ["Network probe skipped by WHYJ_DOCTOR_SKIP_NETWORK."],
    );
  }

  const probe = options.modelProbe ?? defaultModelProbe;
  const result = await runProbe(probe, { state, settings, processEnv, timeoutMs: probeTimeoutMs(options) });
  if (!result.ok) {
    return failPhase("model", `Model · ${state.config.model}`, result.detail, "Check WHYJ_QUANT_API_KEY, WHYJ_QUANT_BASE_URL, model, and network/proxy, then run whyj doctor again.", start, options);
  }
  return passPhase("model", `Model · ${state.config.model}`, `${modelCredential!.entry.value} · ${result.detail}`, start, options);
}

async function checkToolsPhase(
  state: DoctorResult,
  settings: OhQuantSettings,
  options: DoctorOptions,
): Promise<DoctorPhase> {
  const start = timestamp(options);
  try {
    const registry = await import("../tools/registry.ts");
    const source = await import("../source/index.ts");
    const registrations = registry.listBuiltinToolRegistrations();
    if (registrations.length === 0) {
      return failPhase("tools", "Tools", "No built-in tools are registered", "Run bun test src/tools/registry.test.ts.", start, options);
    }
    const schemaSummary = validateToolSchemas(registrations);
    if (!schemaSummary.ok) {
      return failPhase("tools", "Tools", schemaSummary.detail, "Check built-in tool schemas and rerun doctor.", start, options);
    }
    const adapterSummary = inspectSourceAdapters(source);
    if (!adapterSummary.ok) {
      return failPhase("tools", "Tools", adapterSummary.detail, "Check source adapter exports and rerun doctor.", start, options);
    }
    if (settings.preferences?.source === "akshare") {
      const python = checkPython();
      if (!python.ok) {
        return failPhase("tools", "Tools", "Python is not available for AKShare", pythonInstallAction(), start, options);
      }
      const akshare = checkAksharePackage(probeTimeoutMs(options));
      if (!akshare.ok) {
        return failPhase("tools", "Tools", akshare.detail, akshareInstallAction(), start, options);
      }
      return passPhase("tools", "Tools", `schemas loaded · adapters ok · ${python.label} · ${akshare.detail}`, start, options);
    }
    return passPhase("tools", "Tools", `schemas loaded · adapters ok · ${registrations.length} built-in tools`, start, options);
  } catch (error) {
    return failPhase("tools", "Tools", `Tool registry failed: ${errorMessage(error)}`, "Run bun test src/tools/registry.test.ts.", start, options);
  }
}

async function checkDataPhase(
  state: DoctorResult,
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
  options: DoctorOptions,
): Promise<DoctorPhase> {
  const start = timestamp(options);
  const source = state.config.dataSource;
  if (source === "akshare") {
    if (options.skipNetwork) {
      return passPhase(
        "data",
        "Data · AKShare",
        "AKShare requires no data key",
        start,
        options,
        ["Network probe skipped by WHYJ_DOCTOR_SKIP_NETWORK."],
      );
    }
    const probe = options.dataProbe ?? defaultDataProbe;
    const result = await runProbe(probe, { state, settings, processEnv, timeoutMs: probeTimeoutMs(options) });
    if (!result.ok) {
      return failPhase("data", "Data · AKShare", result.detail, "Install Python and akshare, then run whyj doctor again.", start, options);
    }
    return passPhase("data", "Data · AKShare", result.detail, start, options);
  }

  const tokenKey = sourceTokenEnvKey(source);
  if (!tokenKey) {
    return failPhase("data", "Data", `Unsupported data source: ${source}`, "Choose akshare, tushare, llmquant-data, or financial-datasets in /config.", start, options);
  }
  const token = state.auth[tokenKey];
  if (!token?.available) {
    return failPhase("data", `Data · ${source}`, `Missing ${tokenKey}`, `Open /doctor Configure and set ${tokenKey}.`, start, options);
  }

  if (options.skipNetwork) {
    return passPhase(
      "data",
      `Data · ${source}`,
      `${tokenKey} ${token.value}`,
      start,
      options,
      ["Network probe skipped by WHYJ_DOCTOR_SKIP_NETWORK."],
    );
  }

  const probe = options.dataProbe ?? defaultDataProbe;
  const result = await runProbe(probe, { state, settings, processEnv, timeoutMs: probeTimeoutMs(options) });
  if (!result.ok) {
    return failPhase("data", `Data · ${source}`, result.detail, `Check ${tokenKey}, data source coverage, and network/proxy, then run whyj doctor again.`, start, options);
  }
  return passPhase("data", `Data · ${source}`, `${tokenKey} ${token.value} · ${result.detail}`, start, options);
}

function markPhaseChecking(state: DoctorResult, index: number, options: DoctorOptions): DoctorResult {
  const next = cloneState(state);
  const phase = next.phases[index]!;
  next.phases[index] = {
    ...phase,
    status: "checking",
    detail: `Checking ${phase.phase}...`,
    durationMs: timestamp(options),
  };
  return finalizeState(next);
}

function replacePhase(state: DoctorResult, index: number, phase: DoctorPhase): DoctorResult {
  const next = cloneState(state);
  next.phases[index] = phase;
  return finalizeState(next);
}

function finalizeState(state: DoctorResult): DoctorResult {
  const completed = state.phases.every((phase) => phase.status === "pass" || phase.status === "fail");
  const failed = state.phases.some((phase) => phase.status === "fail");
  const sourceTokenKey = sourceTokenEnvKey(state.config.dataSource);
  const modelUnconfigured = !resolveModelCredential(state);
  const dataUnconfigured = state.config.dataSource === "akshare"
    ? false
    : !(sourceTokenKey && (state.auth[sourceTokenKey]?.available ?? false));
  const mode: DoctorMode = modelUnconfigured && dataUnconfigured ? "first_setup" : state.mode;
  const overall: DoctorOverall = mode === "first_setup" && completed
    ? "unconfigured"
    : !completed
      ? "running"
      : failed
        ? "partial_fail"
        : "all_pass";
  const hints = state.phases
    .filter((phase) => phase.status === "fail" && phase.action)
    .map((phase) => phase.action!)
    .filter((hint, index, all) => all.indexOf(hint) === index);

  return {
    ...state,
    mode,
    overall,
    ready: true,
    hints,
  };
}

function pendingPhase(phase: DoctorPhase["phase"], label: string): DoctorPhase {
  return { phase, status: "pending", label, detail: "pending" };
}

function passPhase(
  phase: DoctorPhase["phase"],
  label: string,
  detail: string,
  start: number,
  options: DoctorOptions,
  warnings: string[] = [],
): DoctorPhase {
  return {
    phase,
    status: "pass",
    label,
    detail,
    warnings: warnings.length > 0 ? warnings : undefined,
    durationMs: Math.max(0, timestamp(options) - start),
  };
}

function failPhase(
  phase: DoctorPhase["phase"],
  label: string,
  error: string,
  action: string,
  start: number,
  options: DoctorOptions,
): DoctorPhase {
  return {
    phase,
    status: "fail",
    label,
    detail: error,
    error,
    action,
    durationMs: Math.max(0, timestamp(options) - start),
  };
}

function cloneState(state: DoctorResult): DoctorResult {
  return {
    ...state,
    phases: state.phases.map((phase) => ({ ...phase, warnings: phase.warnings ? [...phase.warnings] : undefined })) as DoctorResult["phases"],
    auth: Object.fromEntries(Object.entries(state.auth).map(([key, value]) => [key, { ...value }])),
    config: { ...state.config },
    hints: [...state.hints],
  };
}

function normalizeRequestedPhases(phases: DoctorPhase["phase"][] | undefined): DoctorPhase["phase"][] {
  if (!phases || phases.length === 0) return [...PHASE_ORDER];
  const valid = phases.filter((phase, index, all) => PHASE_ORDER.includes(phase) && all.indexOf(phase) === index);
  return valid.length > 0 ? valid : [...PHASE_ORDER];
}

function isReusableSeedState(seedState: DoctorResult | undefined, initial: DoctorResult): seedState is DoctorResult {
  if (!seedState) return false;
  if (seedState.config.model !== initial.config.model) return false;
  if (seedState.config.baseUrl !== initial.config.baseUrl) return false;
  if (seedState.config.endpointMode !== initial.config.endpointMode) return false;
  if (seedState.config.dataSource !== initial.config.dataSource) return false;
  for (const key of AUTH_KEYS) {
    const previous = seedState.auth[key];
    const current = initial.auth[key];
    if (!previous || !current) return false;
    if (previous.available !== current.available) return false;
    if (previous.source !== current.source) return false;
    if (previous.value !== current.value) return false;
  }
  return true;
}

function resolvedValue(
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
  key: AuthKey,
): string {
  const fromEnv = typeof processEnv[key] === "string" ? processEnv[key]!.trim() : "";
  if (fromEnv) return stripAnsi(fromEnv);
  const fromConfig = typeof settings.env?.[key] === "string" ? settings.env[key]!.trim() : "";
  return stripAnsi(fromConfig);
}

function definedStringEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function sourceTokenEnvKey(source: string): AuthKey | null {
  switch (source) {
    case "tushare": return "WHYJ_QUANT_TUSHARE_TOKEN";
    case "llmquant-data": return "WHYJ_QUANT_LLMQUANT_API_KEY";
    case "financial-datasets": return "WHYJ_QUANT_FINANCIAL_DATASETS_KEY";
    default: return null;
  }
}

function resolveModelCredential(state: DoctorResult): { key: AuthKey; entry: DoctorResult["auth"][AuthKey] } | null {
  const apiKey = state.auth.WHYJ_QUANT_API_KEY;
  if (apiKey?.available) return { key: "WHYJ_QUANT_API_KEY", entry: apiKey };
  const legacyToken = state.auth.WHYJ_QUANT_AUTH_TOKEN;
  if (legacyToken?.available) return { key: "WHYJ_QUANT_AUTH_TOKEN", entry: legacyToken };
  return null;
}

function checkPython(): { ok: boolean; label: string } {
  for (const command of ["python3", "python"]) {
    try {
      const result = spawnSync(command, ["--version"], { encoding: "utf8" });
      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
      if (result.status === 0) return { ok: true, label: output || command };
    } catch {
      // Try the next command.
    }
  }
  return { ok: false, label: "missing" };
}

function checkAksharePackage(timeoutMs: number): { ok: boolean; detail: string } {
  for (const command of ["python3", "python"]) {
    try {
      const result = spawnSync(command, ["-c", "import akshare as ak; print(getattr(ak, '__version__', 'unknown'))"], {
        encoding: "utf8",
        timeout: timeoutMs,
      });
      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
      if (result.status === 0) return { ok: true, detail: `akshare ${output || "available"}` };
    } catch {
      // Try the next command.
    }
  }
  return { ok: false, detail: "Python package akshare is not importable" };
}

function validateToolSchemas(
  registrations: Array<{ tool: { name: string; parameters: unknown; execute?: unknown } }>,
): { ok: boolean; detail: string } {
  for (const registration of registrations) {
    if (typeof registration.tool.execute !== "function") {
      return { ok: false, detail: `Tool ${registration.tool.name} is missing an execute() implementation` };
    }
    try {
      Compile(registration.tool.parameters as never);
    } catch (error) {
      return { ok: false, detail: `Tool schema failed to compile for ${registration.tool.name}: ${errorMessage(error)}` };
    }
  }
  return { ok: true, detail: `schemas loaded · ${registrations.length} built-in tools` };
}

function inspectSourceAdapters(source: Record<string, unknown>): { ok: boolean; detail: string } {
  const required = [
    "fetchFromAKShare",
    "fetchFromTushare",
    "fetchFromLlmQuant",
    "fetchFromFinancialDatasets",
    "fetchBars",
    "pullBarsFromProviders",
    "searchSymbols",
  ];
  const missing = required.filter((key) => typeof source[key] !== "function");
  if (missing.length > 0) {
    return { ok: false, detail: `Missing source adapter exports: ${missing.join(", ")}` };
  }
  return { ok: true, detail: "adapters ok" };
}

function pythonInstallAction(): string {
  return process.platform === "win32"
    ? "Install Python 3, then rerun doctor. Suggested: winget install Python.Python.3.12"
    : "Install Python 3, then rerun doctor.";
}

function akshareInstallAction(): string {
  return process.platform === "win32"
    ? "Run py -3 -m pip install akshare pandas and retry doctor."
    : "Run python3 -m pip install akshare pandas and retry doctor.";
}

function withEnvOptions(options: DoctorOptions, processEnv: Record<string, string | undefined>): DoctorOptions {
  return {
    ...options,
    skipNetwork: options.skipNetwork ?? /^(1|true|yes)$/i.test(processEnv.WHYJ_DOCTOR_SKIP_NETWORK || ""),
    probeTimeoutMs: options.probeTimeoutMs
      ?? numberFromEnv(processEnv.WHYJ_DOCTOR_TIMEOUT_MS)
      ?? 30_000,
  };
}

function probeTimeoutMs(options: DoctorOptions): number {
  return Math.max(1, options.probeTimeoutMs ?? 30_000);
}

function numberFromEnv(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function runProbe(probe: DoctorProbe, ctx: DoctorProbeContext): Promise<DoctorProbeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe(ctx),
      new Promise<DoctorProbeResult>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, detail: `Timed out after ${ctx.timeoutMs}ms` }), ctx.timeoutMs);
      }),
    ]);
  } catch (error) {
    return { ok: false, detail: errorMessage(error), raw: error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function defaultModelProbe(ctx: DoctorProbeContext): Promise<DoctorProbeResult> {
  const baseUrl = rawEnvValue(ctx.settings, ctx.processEnv, "WHYJ_QUANT_BASE_URL");
  const apiKey = rawModelCredential(ctx.settings, ctx.processEnv);
  const model = ctx.state.config.model || "sonnet";
  if (!baseUrl || !apiKey) return { ok: false, detail: "Missing model provider credentials" };

  const endpointMode = ctx.state.config.endpointMode;
  const anthropic = endpointMode === "Anthropic Messages";
  const url = anthropic ? appendUrlPath(baseUrl, "v1/messages") : openAiChatCompletionsUrl(baseUrl);
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: anthropic
      ? {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      }
      : {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    body: JSON.stringify(anthropic
      ? { model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }
      : { model, max_tokens: 1, messages: [{ role: "user", content: "ping" }], stream: false }),
  }, ctx.timeoutMs);

  return responseToProbeResult(response, endpointMode);
}

async function defaultDataProbe(ctx: DoctorProbeContext): Promise<DoctorProbeResult> {
  switch (ctx.state.config.dataSource) {
    case "akshare":
      return probeAkshare(ctx);
    case "tushare":
      return probeTushare(ctx);
    case "llmquant-data":
      return probeLlmQuant(ctx);
    case "financial-datasets":
      return probeFinancialDatasets(ctx);
    default:
      return { ok: false, detail: `Unsupported data source: ${ctx.state.config.dataSource}` };
  }
}

async function probeLlmQuant(ctx: DoctorProbeContext): Promise<DoctorProbeResult> {
  const apiKey = rawEnvValue(ctx.settings, ctx.processEnv, "WHYJ_QUANT_LLMQUANT_API_KEY");
  if (!apiKey) return { ok: false, detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" };
  const baseUrl = ctx.processEnv.LLMQUANT_BASE_URL || "https://api.llmquantdata.com";
  const url = `${appendUrlPath(baseUrl, "api/equity/historical")}?${new URLSearchParams({ ticker: "AAPL", limit: "1" })}`;
  const response = await fetchWithTimeout(url, { headers: { authorization: `Bearer ${apiKey}` } }, ctx.timeoutMs);
  return responseToProbeResult(response, "llmquant-data");
}

async function probeFinancialDatasets(ctx: DoctorProbeContext): Promise<DoctorProbeResult> {
  const apiKey = rawEnvValue(ctx.settings, ctx.processEnv, "WHYJ_QUANT_FINANCIAL_DATASETS_KEY");
  if (!apiKey) return { ok: false, detail: "Missing WHYJ_QUANT_FINANCIAL_DATASETS_KEY" };
  const baseUrl = ctx.processEnv.FINANCIAL_DATASETS_BASE_URL || "https://api.financialdatasets.ai";
  const url = `${appendUrlPath(baseUrl, "prices/snapshot")}?${new URLSearchParams({ ticker: "AAPL" })}`;
  const response = await fetchWithTimeout(url, { headers: { "X-API-KEY": apiKey } }, ctx.timeoutMs);
  return responseToProbeResult(response, "financial-datasets");
}

async function probeTushare(ctx: DoctorProbeContext): Promise<DoctorProbeResult> {
  const token = rawEnvValue(ctx.settings, ctx.processEnv, "WHYJ_QUANT_TUSHARE_TOKEN");
  if (!token) return { ok: false, detail: "Missing WHYJ_QUANT_TUSHARE_TOKEN" };
  const url = ctx.processEnv.TUSHARE_BASE_URL || "https://api.tushare.pro";
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_name: "daily",
      token,
      params: { ts_code: "000001.SZ", start_date: "20240102", end_date: "20240105" },
      fields: "ts_code,trade_date,close",
    }),
  }, ctx.timeoutMs);
  if (!response.ok) return responseToProbeResult(response, "tushare");
  const payload = await safeJson(response);
  const code = typeof payload === "object" && payload && "code" in payload ? Number((payload as { code?: unknown }).code) : 0;
  if (code !== 0) {
    const msg = typeof payload === "object" && payload && "msg" in payload ? String((payload as { msg?: unknown }).msg || "") : "";
    return { ok: false, detail: `tushare code ${code}${msg ? `: ${msg}` : ""}`, raw: payload };
  }
  return { ok: true, detail: "tushare probe passed", raw: payload };
}

async function probeAkshare(ctx: DoctorProbeContext): Promise<DoctorProbeResult> {
  for (const command of ["python3", "python"]) {
    const result = spawnSync(command, ["-c", "import akshare as ak; print(getattr(ak, '__version__', 'unknown'))"], {
      encoding: "utf8",
      timeout: ctx.timeoutMs,
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    if (result.status === 0) return { ok: true, detail: `akshare ${output || "available"}` };
    if (result.error) continue;
  }
  return { ok: false, detail: "Python package akshare is not importable" };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function responseToProbeResult(response: Response, label: string): Promise<DoctorProbeResult> {
  if (response.ok) {
    const text = await safeText(response);
    return { ok: true, detail: `${label} HTTP ${response.status}`, raw: text ? clip(text, 1_000) : undefined };
  }
  const text = await safeText(response);
  return {
    ok: false,
    detail: `${label} HTTP ${response.status} ${response.statusText}${text ? `: ${clip(text, 300)}` : ""}`,
    raw: text ? clip(text, 1_000) : undefined,
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function rawEnvValue(
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
  key: AuthKey,
): string {
  const fromEnv = typeof processEnv[key] === "string" ? processEnv[key]!.trim() : "";
  if (fromEnv) return fromEnv;
  const fromConfig = typeof settings.env?.[key] === "string" ? settings.env[key]!.trim() : "";
  return fromConfig;
}

function rawModelCredential(
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
): string {
  return rawEnvValue(settings, processEnv, "WHYJ_QUANT_API_KEY")
    || rawEnvValue(settings, processEnv, "WHYJ_QUANT_AUTH_TOKEN");
}

function appendUrlPath(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  return `${cleanBase}/${cleanPath}`;
}

function openAiChatCompletionsUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
}

function writeDoctorLog(state: DoctorResult, options: DoctorOptions): DoctorResult {
  const dir = join(resolveOhquantDir(), "logs", "doctor");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date(timestamp(options)).toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${stamp}.log`);
  const stateWithLog = { ...state, logPath: path };
  const text = redactSensitiveText(JSON.stringify({
    generatedAt: new Date(timestamp(options)).toISOString(),
    overall: stateWithLog.overall,
    mode: stateWithLog.mode,
    config: stateWithLog.config,
    phases: stateWithLog.phases,
    auth: stateWithLog.auth,
    hints: stateWithLog.hints,
  }, null, 2));
  writeFileSync(path, text, "utf8");
  return stateWithLog;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization["']?\s*[:=]\s*["']?Bearer\s+)[^"',\s}]+/gi, "$1[redacted]")
    .replace(/(x-api-key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[redacted]")
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[redacted]")
    .replace(/(token["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[redacted]")
    .replace(/\bsk-[A-Za-z0-9._-]{6,}\b/g, "sk-[redacted]");
}

function clip(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 3)}...`;
}

function buildAlignedTable(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, idx) => Math.max(
    header.length,
    ...rows.map((row) => row[idx]?.length ?? 0),
  ));
  const header = headers.map((cell, idx) => pad(cell, widths[idx])).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rows.map((row) => row.map((cell, idx) => pad(cell, widths[idx])).join("  "));
  return [header, divider, ...body];
}

function compactText(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 3)}...`;
}

function redact(value: string): string {
  const stripped = stripAnsi(value);
  if (stripped.length <= 8) return `${stripped.slice(0, 4)}...${stripped.slice(-4)}`;
  const fp = simpleFingerprint(stripped);
  return `${stripped.slice(0, 4)}...${stripped.slice(-4)} · fp:${fp}`;
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\[\d+(;\d+)*m\]/g, "")
    .trim();
}

function simpleFingerprint(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function timestamp(options: DoctorOptions): number {
  return options.now?.() ?? Date.now();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
