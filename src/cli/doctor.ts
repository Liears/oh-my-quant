import type { OhQuantSettings } from "../types/config.ts";
import { describeEndpointMode, describeModelProtocol } from "../runtime/workspace/doctor-contract.ts";
import { defaultDataProbeRequest, probeDataConnection, type DataProbeOptions } from "../runtime/data/data-readiness.ts";
import { inspectToolReadiness, toolReadinessSummary } from "../runtime/data/tool-readiness.ts";
import type { DataProbeRequest, DataReadiness, PythonReadiness } from "../types/data-readiness.ts";
import type { DoctorMode, DoctorOverall, DoctorPhase, DoctorResult } from "../types/doctor.ts";
import { resolveOhquantDir, resolveSettingsPath } from "../storage/index.ts";
import { resolveModelId } from "../agent/src/session.ts";
import { resolveConfiguredModel, resolveConfiguredAuth } from "../agent/src/model-config.ts";
import { completeSimple } from "../agent/src/kernel/llm.ts";
import { Compile } from "typebox/compile";
import { checkAkshareDependency } from "../source/index.ts";
import * as source from "../source/index.ts";
import { listBuiltinToolRegistrations } from "../tools/registry.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export { describeEndpointMode };
export type { AuthSource, DoctorMode, DoctorOverall, DoctorPhase, DoctorResult, PhaseStatus } from "../types/doctor.ts";

export interface DoctorOptions {
  signal?: AbortSignal;
  dataRequest?: DataProbeRequest;
  now?: () => number;
  probeTimeoutMs?: number;
  skipNetwork?: boolean;
  writeLog?: boolean;
  onState?: (state: DoctorResult) => void;
  modelProbe?: DoctorProbe;
  dataProbe?: DoctorProbe;
  checkDependency?: DataProbeOptions["checkDependency"];
  phases?: DoctorPhase["phase"][];
  seedState?: DoctorResult;
}

export interface DoctorProbeContext {
  state: DoctorResult;
  settings: OhQuantSettings;
  processEnv: Record<string, string | undefined>;
  timeoutMs: number;
  signal?: AbortSignal;
  dataRequest?: DataProbeRequest;
}

export interface DoctorProbeResult {
  ok: boolean;
  detail: string;
  raw?: unknown;
  data?: DataReadiness;
  dependency?: PythonReadiness;
}

export type DoctorProbe = (ctx: DoctorProbeContext) => Promise<DoctorProbeResult>;

const AUTH_KEYS = [
  "MODEL_CREDENTIAL",
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
  settings = structuredClone(settings);
  processEnv = { ...processEnv };
  const effectiveOptions = withEnvOptions(options, processEnv);
  const initial = createInitialState(settings, processEnv);
  if (effectiveOptions.dataRequest) {
    initial.config.dataRequest = { ...effectiveOptions.dataRequest };
    initial.config.dataSource = effectiveOptions.dataRequest.source;
  }
  try {
    const model = resolveConfiguredModel(settings);
    const resolved = await resolveConfiguredAuth(settings, model, processEnv, effectiveOptions.signal);
    const connection = settings.providers?.[model.provider];
    const savedAuth = connection?.apiKey || Object.keys(connection?.env ?? {}).length
      || (resolved?.source && settings.env[resolved.source])
      || (!settings.provider && (settings.env.WHYJ_QUANT_API_KEY || settings.env.WHYJ_QUANT_AUTH_TOKEN));
    initial.auth.MODEL_CREDENTIAL = resolved
      ? { available: true, source: savedAuth ? "config" : "env", value: resolved.auth.apiKey ? redact(resolved.auth.apiKey) : resolved.source ?? "Provider auth" }
      : { available: false, source: "missing", value: "-" };
    if (resolved) initial.mode = "diagnostic";
  } catch { /* checkModelPhase reports configuration errors */ }
  const reusableSeed = isReusableSeedState(effectiveOptions.seedState, initial)
    ? effectiveOptions.seedState
    : undefined;
  const requestedPhases = normalizeRequestedPhases(effectiveOptions.phases);
  let state = createRunState(initial, reusableSeed, requestedPhases);
  const withCapabilities = (current: DoctorResult): DoctorResult => ({ ...current,
    capabilities: inspectToolReadiness(settings, { market: current.config.dataRequest!.market,
      data: current.phases.find(phase => phase.phase === "data")?.data,
      python: current.phases.find(phase => phase.phase === "tools")?.dependency }, processEnv),
  });
  const phaseChecks: Record<DoctorPhase["phase"], (state: DoctorResult) => Promise<DoctorPhase>> = {
    model: (current) => checkModelPhase(current, settings, processEnv, effectiveOptions),
    tools: (current) => checkToolsPhase(current, settings, processEnv, effectiveOptions),
    data: (current) => checkDataPhase(current, settings, processEnv, effectiveOptions),
  };

  for (const phaseName of requestedPhases) {
    const index = PHASE_ORDER.indexOf(phaseName);
    if (index < 0) continue;
    if (effectiveOptions.signal?.aborted) {
      yield withCapabilities(replacePhase(state, index, failPhase(phaseName, titleCase(phaseName), "Doctor check cancelled", "Retry when ready.", timestamp(effectiveOptions), effectiveOptions)));
      break;
    }
    state = markPhaseChecking(state, index, effectiveOptions);
    yield withCapabilities(state);
    const checked = await phaseChecks[phaseName](state);
    state = replacePhase(state, index, checked);
    yield withCapabilities(state);
    if (effectiveOptions.signal?.aborted) break;
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
    `  checked        ${(doctor.requestedPhases ?? PHASE_ORDER).join(", ")}`,
    `  command        whyj doctor`,
    `  mode           ${doctor.mode}`,
    `  model          ${doctor.config.model}`,
    doctor.config.baseUrl
      ? `  base url       ${doctor.config.baseUrl} · ${doctor.config.endpointMode}`
      : "  base url       (not set)",
    `  data source    ${doctor.config.dataSource}`,
    ...(doctor.config.dataRequest ? [`  data sample    ${doctor.config.dataRequest.market} · ${doctor.config.dataRequest.symbol} · ${doctor.config.dataRequest.start} → ${doctor.config.dataRequest.end}`] : []),
    `  settings       ${doctor.config.settingsPath}`,
    "",
    "Phases",
    ...buildAlignedTable(["phase", "status", "detail", "action"], phaseRows).map((line) => `  ${line}`),
    ...(doctor.capabilities ? ["", "Tool capabilities", `  ${toolReadinessSummary(doctor.capabilities)}`,
      "  Sample-verified means input access only; no tool computation was tested.",
      ...doctor.capabilities.map(tool => `  ${tool.name}  ${tool.status}  ${tool.routes.map(route => `${route.provider}: ${route.reason}`).join("; ")}`)] : []),
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
  const provider = doctor.config.provider || "deepseek";
  const example = {
    provider,
    model: doctor.config.model || "deepseek-v4-pro",
    providers: { [provider]: { apiKey: "your-provider-key", baseUrl: doctor.config.baseUrl || undefined } },
    thinkingLevel: "off",
    env: tokenKey ? { [tokenKey]: `your-${source}-key` } : {},
  };
  return [
    "No credentials configured.",
    "Open /config → Model to select a provider, model and credentials.",
    "",
    "Add this to .ohquant/settings.json:",
    "",
    JSON.stringify(example, null, 2),
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
  let model;
  try { model = resolveConfiguredModel(settings); } catch { /* incomplete setup remains editable */ }
  const baseUrl = model?.baseUrl ?? resolvedValue(settings, processEnv, "WHYJ_QUANT_BASE_URL");
  const resolvedModel = stripAnsi(model?.id ?? (settings.provider ? settings.model : resolveDoctorRequestModel(settings, processEnv)));
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
      provider: settings.provider ?? model?.provider,
      baseUrl,
      endpointMode: model ? describeModelProtocol(model.api) : (baseUrl ? describeEndpointMode(baseUrl) : ""),
      dataSource,
      dataRequest: defaultDataProbeRequest(settings),
    },
    hints: [],
  });
}

function createRunState(
  initial: DoctorResult,
  seedState: DoctorResult | undefined,
  requestedPhases: DoctorPhase["phase"][],
): DoctorResult {
  const next = { ...cloneState(initial), requestedPhases: [...requestedPhases] };
  if (!seedState) return finalizeState(next);
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
    if (fromConfig) {
      auth[key] = { available: true, source: "config", value: redact(fromConfig as string) };
    } else if (fromEnv) {
      auth[key] = { available: true, source: "env", value: redact(fromEnv as string) };
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
  try { resolveConfiguredModel(settings); }
  catch (error) { return failPhase("model", "Model", errorMessage(error), "Open /config → Model and check the connection.", start, options); }
  const modelCredential = resolveModelCredential(state);
  const hasModelCredential = Boolean(modelCredential);
  if (!hasModelCredential) {
    return failPhase("model", "Model", "Missing model credentials", "Open /config → Model and set the provider API key or environment credentials.", start, options);
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
  const result = await runProbe(probe, { state, settings, processEnv, timeoutMs: probeTimeoutMs(options), signal: options.signal });
  if (!result.ok) {
    return failPhase("model", `Model · ${state.config.model}`, result.detail, "Open /config → Model; check credentials, endpoint, protocol and network, then retry.", start, options);
  }
  return passPhase("model", `Model · ${state.config.model}`, `${modelCredential!.entry.value} · ${result.detail}`, start, options);
}

async function checkToolsPhase(
  state: DoctorResult,
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
  options: DoctorOptions,
): Promise<DoctorPhase> {
  const start = timestamp(options);
  try {
    const registrations = listBuiltinToolRegistrations();
    if (registrations.length === 0) {
      return failPhase("tools", "Tools", "No built-in tools are registered", "Run bun test src/tools/test/registry.test.ts.", start, options);
    }
    const schemaSummary = validateToolSchemas(registrations);
    if (!schemaSummary.ok) {
      return failPhase("tools", "Tools", schemaSummary.detail, "Check built-in tool schemas and rerun doctor.", start, options);
    }
    const adapterSummary = inspectSourceAdapters(source);
    if (!adapterSummary.ok) {
      return failPhase("tools", "Tools", adapterSummary.detail, "Check source adapter exports and rerun doctor.", start, options);
    }
    if (registrations.some(entry => entry.requirements.routes.some(route => route.dependencies.includes("akshare")))) {
      const checked = await runProbe(async ctx => {
        const dependency = await (options.checkDependency ?? checkAkshareDependency)({ timeoutMs: ctx.timeoutMs, signal: ctx.signal! });
        return { ok: true, detail: "Python dependency inspected", dependency };
      }, { state, settings, processEnv, timeoutMs: probeTimeoutMs(options), signal: options.signal });
      if (!checked.ok || !checked.dependency) return failPhase("tools", "Tools", checked.detail, "Retry Tools checks; Python / akshare status is unverified.", start, options);
      const dependency = checked.dependency;
      if (dependency.status === "missing-python") {
        return { ...failPhase("tools", "Tools", "Python is not available for AKShare tools", pythonInstallAction(), start, options), dependency };
      }
      if (dependency.status === "missing-package") {
        return { ...failPhase("tools", "Tools", "Python package akshare is not importable", akshareInstallAction(), start, options), dependency };
      }
      return { ...passPhase("tools", "Tools", `schemas loaded · adapters ok · Python ${dependency.python} · akshare ${dependency.akshare}`, start, options,
        ["Dependency checks only; per-endpoint permissions remain unverified."]), dependency };
    }
    return passPhase("tools", "Tools", `schemas loaded · adapters ok · ${registrations.length} built-in tools`, start, options);
  } catch (error) {
    return failPhase("tools", "Tools", `Tool registry failed: ${errorMessage(error)}`, "Run bun test src/tools/test/registry.test.ts.", start, options);
  }
}

async function checkDataPhase(
  state: DoctorResult,
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
  options: DoctorOptions,
): Promise<DoctorPhase> {
  const start = timestamp(options);
  const source = options.dataRequest?.source ?? state.config.dataSource;
  const tokenKey = sourceTokenEnvKey(source);
  const token = tokenKey ? state.auth[tokenKey] : undefined;
  if (source !== "akshare" && !tokenKey) {
    return failPhase("data", "Data", "Unsupported data source", "Choose a supported source in /config.", start, options);
  }
  if (options.signal?.aborted) return failPhase("data", "Data", "Data check cancelled", "Retry when ready.", start, options);
  if (options.skipNetwork) {
    if (tokenKey && !token?.available) return failPhase("data", "Data", "Missing " + tokenKey, "Open /config and set " + tokenKey + ".", start, options);
    return passPhase("data", "Data · " + source, source === "akshare" ? "AKShare requires no data key" : tokenKey + " " + token?.value,
      start, options, ["Network probe skipped by WHYJ_DOCTOR_SKIP_NETWORK."]);
  }
  // Injected probes retain the same credential guard; production probes also return structured failure evidence.
  if (options.dataProbe && tokenKey && !token?.available) return failPhase("data", "Data · " + source, "Missing " + tokenKey,
    "Open /config and set " + tokenKey + ".", start, options);
  const context = { state, settings, processEnv, timeoutMs: probeTimeoutMs(options), signal: options.signal, dataRequest: state.config.dataRequest };
  const result = options.dataProbe ? await runProbe(options.dataProbe, context) : await defaultDataProbe(context);
  const phase = result.ok
    ? passPhase("data", "Data · " + source, result.detail, start, options, result.data ? [result.data.action] : [])
    : failPhase("data", "Data · " + source, result.detail, result.data?.action ?? "Check data credentials, coverage and connectivity in /config.", start, options);
  return { ...phase, ...(result.data ? { data: result.data } : {}) };
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
  const selected = state.phases.filter(phase => !state.requestedPhases || state.requestedPhases.includes(phase.phase) || phase.status === "pass" || phase.status === "fail");
  const completed = selected.every((phase) => phase.status === "pass" || phase.status === "fail");
  const failed = selected.some((phase) => phase.status === "fail");
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
  const hints = selected
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
    phases: state.phases.map((phase) => ({ ...phase, warnings: phase.warnings ? [...phase.warnings] : undefined,
      ...(phase.data ? { data: structuredClone(phase.data) } : {}), ...(phase.dependency ? { dependency: { ...phase.dependency } } : {}) })) as DoctorResult["phases"],
    ...(state.capabilities ? { capabilities: structuredClone(state.capabilities) } : {}),
    auth: Object.fromEntries(Object.entries(state.auth).map(([key, value]) => [key, { ...value }])),
    config: structuredClone(state.config),
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
  if (JSON.stringify(seedState.config.dataRequest) !== JSON.stringify(initial.config.dataRequest)) return false;
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
  if (state.auth.MODEL_CREDENTIAL?.available) return { key: "MODEL_CREDENTIAL", entry: state.auth.MODEL_CREDENTIAL };
  if (state.config.provider) return null;
  const apiKey = state.auth.WHYJ_QUANT_API_KEY;
  if (apiKey?.available) return { key: "WHYJ_QUANT_API_KEY", entry: apiKey };
  const legacyToken = state.auth.WHYJ_QUANT_AUTH_TOKEN;
  if (legacyToken?.available) return { key: "WHYJ_QUANT_AUTH_TOKEN", entry: legacyToken };
  return null;
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
  const controller = new AbortController();
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  let onAbort: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    return await Promise.race([
      probe({ ...ctx, signal }),
      new Promise<DoctorProbeResult>(resolve => {
        onAbort = () => resolve({ ok: false, detail: ctx.signal?.aborted ? "Doctor check cancelled" : "Timed out after " + ctx.timeoutMs + "ms" });
        if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } catch (error) {
    return { ok: false, detail: ctx.signal?.aborted ? "Doctor check cancelled" : errorMessage(error), raw: error };
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function defaultModelProbe(ctx: DoctorProbeContext): Promise<DoctorProbeResult> {
  const deadline = AbortSignal.timeout(ctx.timeoutMs);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, deadline]) : deadline;
  const model = resolveConfiguredModel(ctx.settings);
  const auth = await resolveConfiguredAuth(ctx.settings, model, ctx.processEnv, signal);
  if (!auth) return { ok: false, detail: "Missing model provider credentials" };
  const requestModel = auth.auth.baseUrl ? { ...model, baseUrl: auth.auth.baseUrl } : model;
  try {
    const response = await completeSimple(requestModel, {
      messages: [{ role: "user", content: "Reply with only OK.", timestamp: Date.now() }],
    }, { ...auth.auth, env: auth.env, maxTokens: Math.min(32, model.maxTokens), maxRetries: 0, timeoutMs: ctx.timeoutMs, signal });
    const text = response.content.filter(part => part.type === "text").map(part => part.text).join("").trim();
    if (response.stopReason === "error" || response.stopReason === "aborted" || !text) {
      throw new Error(response.errorMessage || (signal.aborted ? "Model request timed out" : "Model returned no text"));
    }
  } catch (error) {
    // Some Pi providers authenticate entirely through headers (e.g. Cloudflare).
    const secrets = [auth.auth.apiKey, ctx.settings.providers?.[model.provider]?.apiKey,
      ...Object.values(auth.auth.headers ?? {}).flatMap(value => value ? [value, value.replace(/^Bearer\s+/i, "")] : [])];
    let detail = errorMessage(error);
    for (const secret of secrets) if (secret) detail = detail.split(secret).join("[redacted]");
    return { ok: false, detail };
  }
  return { ok: true, detail: `${model.provider} · ${model.api} · response received` };
}

export function resolveDoctorRequestModel(
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
): string {
  if (settings.provider) return resolveConfiguredModel(settings).id;
  const modelEnv: Record<string, string> = {
    ...definedStringEnv(processEnv),
    ...settings.env,
  };
  return resolveModelId(settings.model || "sonnet", modelEnv).trim();
}

async function defaultDataProbe(ctx: DoctorProbeContext): Promise<DoctorProbeResult> {
  const data = await probeDataConnection(ctx.settings, ctx.dataRequest ?? defaultDataProbeRequest(ctx.settings),
    { processEnv: ctx.processEnv, timeoutMs: ctx.timeoutMs, signal: ctx.signal });
  return { ok: data.status === "ready", detail: data.detail, data };
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
    capabilities: stateWithLog.capabilities,
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
  if (stripped.length <= 8) return "[hidden]";
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
