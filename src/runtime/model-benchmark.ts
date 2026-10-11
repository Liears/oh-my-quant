import { createHash } from "node:crypto";
import type { AssistantMessage, Context, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { streamSimple } from "../agent/src/kernel/llm.ts";
import { configuredThinking, resolveConfiguredAuth, resolveConfiguredModel } from "../agent/src/model-config.ts";
import { listBuiltinToolRegistrations } from "../tools/registry.ts";
import type { OhQuantSettings } from "../types/config.ts";
import { assistantEventHasVisibleOutput, assistantMessageHasVisibleOutput, computeTpotMs, extractAssistantOutputTokens } from "./hud.ts";
import manifest from "../../package.json";

export const MODEL_BENCHMARK_PROMPT = "Explain compound returns in approximately 100 words using only this example: +10% followed by -10%. State the cumulative return and why adding returns is incorrect. Do not fetch data or execute tools.";
const SYSTEM_PROMPT = "You are a quantitative research assistant. Answer the fixed arithmetic question concisely. No external data is needed.";

export interface ModelBenchmarkOptions {
  samples?: number;
  warmups?: number;
  timeoutMs?: number;
  maxTokens?: number;
  thinking?: OhQuantSettings["thinkingLevel"];
  /** Offer current quant schemas to measure request overhead; never execute tools. */
  tools?: "off" | "quant-schema";
  signal?: AbortSignal;
  processEnv?: Record<string, string | undefined>;
}

export interface ModelBenchmarkSample {
  index: number;
  warmup: boolean;
  startedAt: string;
  status: "success" | "missing-auth" | "auth-failed" | "request-failed" | "empty-response" | "timeout" | "cancelled";
  httpStatus: number | null;
  endpointHash: string | null;
  /** Includes auth resolution, transport and application consumption. */
  durationMs: number;
  /** From stream invocation to first nonempty text/thinking/tool output. */
  ttftMs: number | null;
  tpotMs: number | null;
  outputTokens: number | null;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  stopReason: string | null;
}

export function latencyDistribution(values: readonly (number | null)[]) {
  const sorted = values.filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted.length ? sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]! : null;
  return { samples: sorted.length, p50: percentile(0.5), p95: percentile(0.95), min: sorted.length ? sorted[0]! : null, max: sorted.at(-1) ?? null };
}

/** One fresh request per sample, through the same Pi connection resolver and protocol as chat.
 * No session, tool execution, market access, settings writes or model response storage.
 */
export async function runModelBenchmark(settings: OhQuantSettings, options: ModelBenchmarkOptions = {}) {
  const snapshot = structuredClone(settings);
  const processEnv = { ...(options.processEnv ?? process.env) };
  if (options.thinking !== undefined) {
    if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(options.thinking)) throw new Error("Invalid thinking level");
    snapshot.thinkingLevel = options.thinking;
  }
  const samples = options.samples ?? 5;
  const warmups = options.warmups ?? 0;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxTokens = options.maxTokens ?? 1024;
  for (const [name, value, min, max] of [["samples", samples, 1, 100], ["warmups", warmups, 0, 10],
    ["timeoutMs", timeoutMs, 1, 600_000], ["maxTokens", maxTokens, 2, 32768]] as const) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  const toolsMode = options.tools ?? "off";
  if (!["off", "quant-schema"].includes(toolsMode)) throw new Error("tools must be off or quant-schema");
  const model = resolveConfiguredModel(snapshot);
  const thinking = configuredThinking(snapshot);
  const tools = toolsMode === "off" ? [] : listBuiltinToolRegistrations("quant").filter(entry => entry.enabledByDefault !== false)
    .map(({ tool }) => ({ name: tool.name, description: tool.description, parameters: structuredClone(tool.parameters) }));
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const config = {
    provider: model.provider, model: model.id, api: model.api, endpointHash: hash(model.baseUrl),
    requestedThinking: snapshot.thinkingLevel, thinking, contextWindow: model.contextWindow,
    maxTokens: Math.min(maxTokens, model.maxTokens), tools: toolsMode, toolNames: tools.map(tool => tool.name),
    toolSchemaHash: hash(JSON.stringify(tools)), toolExecution: false,
    prompt: MODEL_BENCHMARK_PROMPT, systemPrompt: SYSTEM_PROMPT, samples, warmups, timeoutMs,
    concurrency: 1, maxRetries: 0, cacheRetention: "none", transport: "sse",
  };
  const startedAt = new Date().toISOString();
  const results: ModelBenchmarkSample[] = [];
  for (let index = 0; index < warmups + samples; index++) {
    if (options.signal?.aborted) break;
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = performance.now();
    const sample: ModelBenchmarkSample = { index: index + 1, warmup: index < warmups, startedAt: new Date().toISOString(),
      status: "request-failed", durationMs: 0, ttftMs: null, tpotMs: null, outputTokens: null,
      inputTokens: null, cacheReadTokens: null, stopReason: null, httpStatus: null, endpointHash: null };
    let onAbort: (() => void) | undefined;
    try {
      const consume = async (): Promise<ModelBenchmarkSample["status"]> => {
        let auth;
        try { auth = await resolveConfiguredAuth(snapshot, model, processEnv, signal); }
        catch { return "auth-failed"; }
        signal.throwIfAborted();
        if (!auth) return "missing-auth";
        const requestModel = auth.auth.baseUrl ? { ...model, baseUrl: auth.auth.baseUrl } : model;
        sample.endpointHash = hash(requestModel.baseUrl);
        const context: Context = { systemPrompt: SYSTEM_PROMPT, messages: [{ role: "user", content: MODEL_BENCHMARK_PROMPT, timestamp: 0 }], tools };
        const streamOptions: SimpleStreamOptions = { ...auth.auth, env: auth.env, signal, timeoutMs, maxRetries: 0,
          maxTokens: config.maxTokens, reasoning: thinking === "off" ? undefined : thinking,
          cacheRetention: "none", transport: "sse", onResponse: response => { if (!signal.aborted) sample.httpStatus = response.status; } };
        const requestStart = performance.now();
        let firstOutputAt: number | null = null;
        let last: AssistantMessage | null = null;
        let endedAt: number | null = null;
        for await (const event of streamSimple(requestModel, context, streamOptions)) {
          signal.throwIfAborted();
          if (firstOutputAt === null && assistantEventHasVisibleOutput(event)) firstOutputAt = performance.now();
          if (event.type === "done" || event.type === "error") {
            last = event.type === "done" ? event.message : event.error;
            endedAt = performance.now();
          }
        }
        signal.throwIfAborted();
        if (!last || last.stopReason === "error" || last.stopReason === "aborted" || last.stopReason === "deferred") return "request-failed";
        sample.stopReason = last.stopReason;
        if (!assistantMessageHasVisibleOutput(last)) return "empty-response";
        // A final-only response has no observable first token time. Keep it unmeasured.
        sample.ttftMs = firstOutputAt === null ? null : firstOutputAt - requestStart;
        sample.outputTokens = extractAssistantOutputTokens(last);
        sample.inputTokens = Number.isSafeInteger(last.usage.input) && last.usage.input >= 0 ? last.usage.input : null;
        sample.cacheReadTokens = Number.isSafeInteger(last.usage.cacheRead) && last.usage.cacheRead >= 0 ? last.usage.cacheRead : null;
        sample.tpotMs = computeTpotMs(firstOutputAt === null || endedAt === null ? null : endedAt - firstOutputAt, sample.outputTokens);
        return "success";
      };
      sample.status = await Promise.race([consume(), new Promise<ModelBenchmarkSample["status"]>(resolve => {
        onAbort = () => resolve(options.signal?.aborted ? "cancelled" : "timeout");
        if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
      })]);
    } catch { sample.status = signal.aborted ? options.signal?.aborted ? "cancelled" : "timeout" : "request-failed"; }
    finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
      controller.abort();
    }
    sample.durationMs = performance.now() - start;
    results.push({ ...sample });
    if (sample.status === "cancelled") break;
  }
  const measured = results.filter(result => !result.warmup);
  const succeeded = measured.filter(result => result.status === "success");
  return {
    version: 1, kind: "model-request-benchmark", startedAt, completedAt: new Date().toISOString(),
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch, pi: manifest.dependencies["@earendil-works/pi-ai"] },
    config, configHash: hash(JSON.stringify(config)), cancelled: Boolean(options.signal?.aborted),
    summary: { requested: samples, attempted: measured.length, succeeded: succeeded.length, failed: measured.length - succeeded.length,
      skipped: samples - measured.length, warmupSucceeded: results.filter(result => result.warmup && result.status === "success").length,
      warmupFailed: results.filter(result => result.warmup && result.status !== "success").length,
      ttftMs: latencyDistribution(succeeded.map(result => result.ttftMs)), tpotMs: latencyDistribution(succeeded.map(result => result.tpotMs)),
      durationMs: latencyDistribution(succeeded.map(result => result.durationMs)) },
    measurement: { clock: "performance.now", percentile: "nearest-rank", aggregation: "successful non-warmup requests; each metric excludes null independently",
      ttft: "stream invocation to first nonempty text, thinking or tool call; empty block starts excluded; final-only null",
      tpot: "(terminal event time - first output time) / (reported output tokens - 1); at least 2 tokens; includes stream finalization",
      scope: "Application-side single model requests. No tool execution, market work, Agent loop, session persistence or terminal rendering. Cache policy and retry limits are provider-dependent." },
    results,
  };
}
