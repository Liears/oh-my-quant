import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DEFAULT_SETTINGS, type OhQuantSettings } from "../../types/config.ts";
import { latencyDistribution, MODEL_BENCHMARK_PROMPT, runModelBenchmark } from "../evaluation/model-benchmark.ts";

type Mode = "ok" | "one-token" | "no-usage" | "empty" | "denied" | "timeout" | "thinking" | "tool";
let server: ReturnType<typeof Bun.serve>;
let settings: OhQuantSettings;
let modes: Mode[];
let requests: { body: Record<string, unknown>; authorization: string | null }[];
let previousNoProxy: string | undefined;
const timers = new Set<ReturnType<typeof setTimeout>>();

beforeEach(() => {
  previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = "127.0.0.1,localhost";
  modes = [];
  requests = [];
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as Record<string, unknown>;
    const mode = modes[requests.length] ?? "ok";
    requests.push({ body, authorization: request.headers.get("authorization") });
    if (mode === "denied") return Response.json({ error: { message: "fixture-secret do not echo this response" } }, { status: 403 });
    const chunk = (delta: object, finish: string | null = null) => ({ id: "fixture", object: "chat.completion.chunk", created: 0, model: body.model,
      choices: [{ index: 0, delta, finish_reason: finish }] });
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (data: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
        send(chunk({ role: "assistant", content: "" }));
        if (mode === "timeout") return;
        const first = setTimeout(() => {
          timers.delete(first);
          if (mode === "thinking") send(chunk({ reasoning_content: "Evaluate compounding" }));
          else if (mode === "tool") send(chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "check_risk", arguments: "{}" } }] }));
          else if (mode !== "empty") send(chunk({ content: "Cumulative return is -1%." }));
          const end = setTimeout(() => {
            timers.delete(end);
            if (mode === "thinking") send(chunk({ content: "Cumulative return is -1%." }));
            send(chunk({}, mode === "tool" ? "tool_calls" : "stop"));
            if (mode !== "no-usage") send({ ...chunk({}), choices: [], usage: { prompt_tokens: 40, completion_tokens: mode === "one-token" ? 1 : 5, total_tokens: 45 } });
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          }, 15);
          timers.add(end);
        }, 15);
        timers.add(first);
      },
    }), { headers: { "content-type": "text/event-stream" } });
  } });
  settings = { ...structuredClone(DEFAULT_SETTINGS), provider: "custom", model: "benchmark-fixture", thinkingLevel: "off",
    providers: { custom: { api: "openai-completions", baseUrl: `${server.url}v1`, apiKey: "fixture-secret" } } };
});

afterEach(() => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  server.stop(true);
  if (previousNoProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previousNoProxy;
});

it("uses nearest-rank percentiles with explicit empty and finite sample counts", () => {
  expect(latencyDistribution([null, NaN, Infinity, -1])).toEqual({ samples: 0, p50: null, p95: null, min: null, max: null });
  expect(latencyDistribution([50, 20, 10, 40, 30, null])).toEqual({ samples: 5, p50: 30, p95: 50, min: 10, max: 50 });
});

it("measures real Pi SSE requests, excludes warmups/failures and records the fixed configuration", async () => {
  modes = ["ok", "ok", "denied", "one-token", "no-usage"];
  const original = structuredClone(settings);
  const report = await runModelBenchmark(settings, { samples: 4, warmups: 1, maxTokens: 128 });
  expect(report.summary).toMatchObject({ requested: 4, attempted: 4, succeeded: 3, failed: 1, skipped: 0, warmupSucceeded: 1,
    ttftMs: { samples: 3 }, tpotMs: { samples: 1 } });
  expect(report.config).toMatchObject({ model: "benchmark-fixture", tools: "off", thinking: "off", maxTokens: 128, prompt: MODEL_BENCHMARK_PROMPT });
  expect(report.results.map(sample => sample.status)).toEqual(["success", "success", "request-failed", "success", "success"]);
  const valid = report.results[1]!;
  expect(valid.ttftMs).toBeGreaterThanOrEqual(10);
  expect(valid.tpotMs).toBeGreaterThan(0);
  expect(valid.durationMs).toBeGreaterThan(valid.ttftMs! + valid.tpotMs! * 4);
  expect(valid.outputTokens).toBe(5);
  // The Pi OpenAI adapter does not invoke onResponse for SDK-rejected responses.
  expect(report.results[2]).toMatchObject({ httpStatus: null, ttftMs: null, tpotMs: null });
  expect(report.results[3]).toMatchObject({ outputTokens: 1, tpotMs: null });
  expect(report.results[4]!.tpotMs).toBeNull();
  expect(new Set(requests.map(request => JSON.stringify(request.body))).size).toBe(1);
  expect(requests.every(request => request.authorization === "Bearer fixture-secret")).toBe(true);
  expect(JSON.stringify(report)).not.toContain("fixture-secret");
  expect(JSON.stringify(report)).not.toContain("do not echo");
  expect(settings).toEqual(original);
});

it("offers exact quant schemas without executing calls, with thinking/tool first outputs", async () => {
  modes = ["thinking", "tool", "empty"];
  const report = await runModelBenchmark(settings, { samples: 3, tools: "quant-schema" });
  expect(report.config.toolNames).toContain("check_risk");
  expect(report.config.toolExecution).toBe(false);
  expect(requests).toHaveLength(3);
  expect((requests[0]!.body.tools as unknown[]).length).toBe(report.config.toolNames.length);
  expect(report.results.map(sample => sample.status)).toEqual(["success", "success", "empty-response"]);
  expect(report.results[1]!.stopReason).toBe("toolUse");
  expect(report.summary.ttftMs.samples).toBe(2);
});

it("bounds pending streams, cancels the batch and never substitutes zero for skipped samples", async () => {
  modes = ["timeout", "timeout"];
  const timed = await runModelBenchmark(settings, { samples: 1, timeoutMs: 80 });
  expect(timed.results[0]!.status).toBe("timeout");
  expect(timed.summary.ttftMs).toMatchObject({ samples: 0, p50: null, p95: null });
  const controller = new AbortController();
  const pending = runModelBenchmark(settings, { samples: 5, signal: controller.signal });
  const cancel = setTimeout(() => controller.abort(), 40);
  const cancelled = await pending;
  clearTimeout(cancel);
  expect(cancelled.cancelled).toBe(true);
  expect(cancelled.summary).toMatchObject({ attempted: 1, failed: 1, skipped: 4 });
  expect(cancelled.results[0]!.status).toBe("cancelled");
  const before = requests.length;
  const preCancelled = await runModelBenchmark(settings, { samples: 2, signal: controller.signal });
  expect(preCancelled.summary).toMatchObject({ attempted: 0, skipped: 2 });
  expect(requests.length).toBe(before);
});

it("rejects invalid inputs before requests and reports missing auth without leaking errors", async () => {
  await expect(runModelBenchmark(settings, { samples: 0 })).rejects.toThrow("samples");
  await expect(runModelBenchmark(settings, { maxTokens: NaN })).rejects.toThrow("maxTokens");
  await expect(runModelBenchmark(settings, { thinking: "wrong" })).rejects.toThrow("thinking");
  expect(requests).toHaveLength(0);
  const report = await runModelBenchmark({ ...settings, provider: "deepseek", model: "deepseek-chat", providers: {} }, { samples: 2, processEnv: {} });
  expect(report.summary).toMatchObject({ failed: 2, succeeded: 0 });
  expect(report.results.every(sample => sample.status === "missing-auth")).toBe(true);
  expect(requests).toHaveLength(0);
});

it("provides a real script entry, immutable output and read-only legacy configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-model-benchmark-"));
  try {
    const configPath = join(root, "settings.json");
    const output = join(root, "result.json");
    const original = JSON.stringify({ ...settings, version: 2 });
    writeFileSync(configPath, original);
    const run = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, "run", "src/runtime/dev/measure-model.ts", ...args], {
        cwd: resolve(import.meta.dir, "../../.."), env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe",
      });
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { exit, stdout, stderr };
    };
    expect((await run("--help")).exit).toBe(0);
    expect(requests).toHaveLength(0);
    const success = await run("--samples", "2", "--output", output);
    expect(success.exit).toBe(0);
    const report = JSON.parse(success.stdout);
    expect(report.summary.succeeded).toBe(2);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(report);
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(readdirSync(root).sort()).toEqual(["result.json", "settings.json"]);
    const before = requests.length;
    expect((await run("--output", output)).exit).toBe(1);
    expect(requests.length).toBe(before);
    modes[before] = "denied";
    const failed = await run("--samples", "1");
    expect(failed.exit).toBe(1);
    expect(JSON.parse(failed.stdout).summary.failed).toBe(1);
    expect(failed.stdout + failed.stderr).not.toContain("fixture-secret");
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected benchmark fixture path");
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
