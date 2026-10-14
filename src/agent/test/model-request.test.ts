import { createLocalAgent as createAgent } from "../../runtime/session.ts";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { type QuantAgentSession } from "../src/session.ts";
import { collectDoctor } from "../../cli/doctor.ts";
import { loadSettings, saveSettings } from "../../storage/index.ts";
import { DEFAULT_SETTINGS, type OhQuantSettings } from "../../types/config.ts";
import { buildSettingsCase, runCase } from "../../../scripts/provider-smoke.ts";
import { AppRuntime } from "../../app-runtime.ts";

// A local request still includes cold SDK/session setup on hosted Windows.
// Keep that budget separate from Bun's watchdog; timeout fixtures never reply.
const PROBE_TIMEOUT_MS = 2_000;
const PROBE_TEST_TIMEOUT_MS = 10_000;

type RequestBody = { model: string; messages: unknown[] };
let root: string;
let previousDir: string | undefined;
let previousNoProxy: string | undefined;
let server: ReturnType<typeof Bun.serve>;
let cfg: OhQuantSettings;
let mode: "ok" | "empty" | "unauthorized" | "timeout";
let requests: Array<{ path: string; auth: string | null; gatewayAuth: string | null; body: RequestBody }>;
let agent: QuantAgentSession | undefined;

beforeEach(() => {
  previousDir = process.env.OHQUANT_DIR;
  previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = "127.0.0.1,localhost";
  root = mkdtempSync(join(tmpdir(), "whyj-model-request-"));
  process.env.OHQUANT_DIR = root;
  requests = [];
  mode = "ok";
  agent = undefined;
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const body = await request.json() as RequestBody;
      requests.push({ path: new URL(request.url).pathname, auth: request.headers.get("authorization"), gatewayAuth: request.headers.get("cf-aig-authorization"), body });
      if (mode === "timeout") return new Response(new ReadableStream<Uint8Array>({ start() {} }), { headers: { "content-type": "text/event-stream" } });
      if (mode === "unauthorized") return Response.json({ error: { message: "Unauthorized fixture-secret", type: "authentication_error" } }, { status: 401 });
      const chunk = { id: "fixture", object: "chat.completion.chunk", created: 0, model: body.model };
      const chunks = [
        { ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: mode === "empty" ? "" : "OK" }, finish_reason: null }] },
        { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ];
      return new Response(chunks.map(value => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    },
  });
  cfg = { ...structuredClone(DEFAULT_SETTINGS), provider: "custom", model: "fixture-one", thinkingLevel: "off",
    providers: { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "fixture-secret" } } };
  saveSettings(cfg);
});

afterEach(async () => {
  agent?.abort();
  server.stop(true);
  await agent?.waitForIdle();
  if (previousDir === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previousDir;
  if (previousNoProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previousNoProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected fixture directory");
  rmSync(root, { recursive: true, force: true });
});

it("switches model and provider after saving without losing conversation or session identity", async () => {
  agent = createAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  await agent.prompt("Remember the first question");
  const metadata = await agent.getSessionMetadata();
  expect(agent.state.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "OK" }] });
  cfg.provider = "deepseek";
  cfg.model = "deepseek-chat";
  cfg.providers!.deepseek = { baseUrl: `${server.url}next/v1`, apiKey: "second-provider-key" };
  saveSettings(cfg);
  expect(loadSettings()).toMatchObject({ provider: "deepseek", model: "deepseek-chat" });
  await agent.prompt("Continue with the same conversation");
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({ path: "/v1/chat/completions", auth: "Bearer fixture-secret", body: { model: "fixture-one" } });
  expect(requests[1]).toMatchObject({ path: "/next/v1/chat/completions", auth: "Bearer second-provider-key", body: { model: "deepseek-chat" } });
  expect(JSON.stringify(requests[1]!.body.messages)).toContain("Remember the first question");
  expect((await agent.getSessionMetadata())?.id).toBe(metadata?.id);
  expect(agent.state.model).toMatchObject({ provider: "deepseek", id: "deepseek-chat" });
  const report = await collectDoctor(loadSettings(), {}, { phases: ["model"], writeLog: false, probeTimeoutMs: 2000 });
  expect(report.phases.map(phase => phase.status)).toEqual(["pass", "pending", "pending"]);
  expect(requests[2]).toMatchObject({ path: requests[1]!.path, auth: requests[1]!.auth, body: { model: requests[1]!.body.model } });
  expect(report.config).toMatchObject({ provider: "deepseek", model: "deepseek-chat" });
});

it("keeps a running conversation's endpoint and key together until the next submitted prompt", async () => {
  agent = createAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  let queued = false;
  agent.subscribe(async event => {
    if (event.type !== "before_provider_payload" || queued) return;
    queued = true;
    cfg.providers!.custom = { baseUrl: `${server.url}changed/v1`, apiKey: "changed-key" };
    cfg.model = "fixture-two";
    saveSettings(cfg);
    await agent!.followUp({ role: "user", content: "Queued continuation", timestamp: 0 });
  });
  await agent.prompt("First prompt");
  expect(requests).toHaveLength(2);
  for (const request of requests) expect(request).toMatchObject({ path: "/v1/chat/completions", auth: "Bearer fixture-secret", body: { model: "fixture-one" } });
  await agent.prompt("New prompt");
  expect(requests[2]).toMatchObject({ path: "/changed/v1/chat/completions", auth: "Bearer changed-key", body: { model: "fixture-two" } });
});

it("does not rotate a running connection's key when a concurrent prompt is rejected", async () => {
  agent = createAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  let attempted = false;
  agent.subscribe(async event => {
    if (event.type !== "before_provider_payload" || attempted) return;
    attempted = true;
    cfg.providers!.custom!.apiKey = "rotated-key";
    saveSettings(cfg);
    await expect(agent!.prompt("Concurrent prompt")).rejects.toThrow("busy");
    await agent!.followUp({ role: "user", content: "Continue the active turn", timestamp: 0 });
  });
  await agent.prompt("First prompt");
  expect(requests).toHaveLength(2);
  expect(requests.map(request => request.auth)).toEqual(["Bearer fixture-secret", "Bearer fixture-secret"]);
  await agent.prompt("Apply rotation now");
  expect(requests[2]?.auth).toBe("Bearer rotated-key");
});

it("uses the saved Pi environment and header-only auth for prompts, compaction and branch summaries", async () => {
  cfg.provider = "cloudflare-ai-gateway";
  cfg.model = "workers-ai/fixture-model";
  cfg.providers![cfg.provider] = { api: "openai-completions", apiKey: "fixture-secret",
    baseUrl: `${server.url}{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/v1`,
    env: { CLOUDFLARE_ACCOUNT_ID: "fixture-account", CLOUDFLARE_GATEWAY_ID: "first-gateway" } };
  saveSettings(cfg);
  agent = createAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  await agent.prompt("First research question");
  const firstLeaf = await agent.getLeafId();
  await agent.prompt("Second research question");
  cfg.providers![cfg.provider]!.env!.CLOUDFLARE_GATEWAY_ID = "summary-gateway";
  cfg.providers![cfg.provider]!.apiKey = "summary-key";
  saveSettings(cfg);
  const compacted = await agent.compact();
  expect(compacted.summary).toContain("OK");
  const compactRequests = requests.slice(2);
  expect(compactRequests.length).toBeGreaterThan(0);
  await agent.navigateTree(firstLeaf!, { summarize: true });
  expect(requests.length).toBeGreaterThan(2 + compactRequests.length);
  for (const request of requests.slice(2)) expect(request).toMatchObject({
    path: "/fixture-account/summary-gateway/v1/chat/completions", auth: null, gatewayAuth: "Bearer summary-key",
    body: { model: "workers-ai/fixture-model" },
  });
});

it.each(["empty", "unauthorized", "timeout"] as const)("Doctor rejects %s responses using the real Pi stream parser", async responseMode => {
  mode = responseMode;
  let dataCalls = 0;
  const started = Date.now();
  const report = await collectDoctor(cfg, {}, { phases: ["model"], writeLog: false, probeTimeoutMs: PROBE_TIMEOUT_MS,
    dataProbe: async () => { dataCalls++; return { ok: true, detail: "unexpected" }; },
  });
  expect(report.overall).toBe("partial_fail");
  expect(report.phases[0].status).toBe("fail");
  expect(requests).toHaveLength(1);
  if (mode === "empty") expect(report.phases[0].error).toContain("no text");
  if (mode === "unauthorized") expect(report.phases[0].error).toContain("Unauthorized");
  expect(report.phases.slice(1).map(phase => phase.status)).toEqual(["pending", "pending"]);
  expect(dataCalls).toBe(0);
  expect(JSON.stringify(report)).not.toContain("fixture-secret");
  expect(Date.now() - started).toBeLessThan(PROBE_TEST_TIMEOUT_MS);
}, PROBE_TEST_TIMEOUT_MS);

it.each(["slash", "shell"] as const)("reports model failure in %s CLI JSON without exposing credentials", async entry => {
  mode = "unauthorized";
  const args = entry === "slash" ? ["-c", "/doctor --phase model"] : ["doctor", "--phase", "model"];
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../index.ts"), "--json", ...args], {
    cwd: root, env: { ...process.env, WHYJ_DOCTOR_SKIP_NETWORK: "0", WHYJ_DOCTOR_TIMEOUT_MS: "2000" },
    stdout: "pipe", stderr: "pipe",
    timeout: 10_000,
  });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    // Doctor's compatibility envelope reports successful collection; phases carry readiness.
    expect(exitCode).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.ok).toBe(true);
    expect(report.data.overall).toBe("partial_fail");
    expect(report.data.requestedPhases).toEqual(["model"]);
    expect(report.data.phases.map((phase: { status: string }) => phase.status)).toEqual(["fail", "pending", "pending"]);
    expect(stdout + stderr).not.toContain("fixture-secret");
  } finally { child.kill(); await child.exited; }
  expect(requests).toHaveLength(1);
}, 15_000);

it("hides short API keys and reports missing active-provider credentials", async () => {
  cfg.providers!.custom!.apiKey = "abcd";
  const report = await collectDoctor(cfg, {}, { phases: ["model"], writeLog: false, skipNetwork: true });
  expect(JSON.stringify(report)).not.toContain("abcd");
  cfg.provider = "openai";
  cfg.model = "gpt-4o";
  cfg.env.WHYJ_QUANT_API_KEY = "unrelated-legacy-key";
  const missing = await collectDoctor(cfg, {}, { phases: ["model"], writeLog: false, skipNetwork: true });
  expect(missing.phases[0].status).toBe("fail");
  expect(missing.auth.MODEL_CREDENTIAL?.available).toBe(false);
  expect(missing.phases[0].action).toContain("/config");
});

it("sends and redacts header-only Pi provider credentials in Doctor", async () => {
  mode = "unauthorized";
  cfg.provider = "cloudflare-ai-gateway";
  cfg.model = "workers-ai/fixture-model";
  cfg.providers![cfg.provider] = { api: "openai-completions", baseUrl: `${server.url}v1`, apiKey: "fixture-secret",
    env: { CLOUDFLARE_ACCOUNT_ID: "fixture-account", CLOUDFLARE_GATEWAY_ID: "fixture-gateway" } };
  const report = await collectDoctor(cfg, {}, { phases: ["model"], writeLog: false, probeTimeoutMs: 2000 });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ auth: null, gatewayAuth: "Bearer fixture-secret" });
  expect(report.phases[0].status).toBe("fail");
  expect(report.phases[0].error).toContain("Unauthorized");
  expect(JSON.stringify(report)).not.toContain("fixture-secret");
  delete cfg.providers![cfg.provider]!.apiKey;
  cfg.providers![cfg.provider]!.env!.CLOUDFLARE_API_KEY = "fixture-secret";
  const smoke = await runCase(buildSettingsCase(cfg)!, 2000);
  expect(smoke.ok).toBe(false);
  expect(smoke.error).toContain("Unauthorized");
  expect(JSON.stringify(smoke)).not.toContain("fixture-secret");
});

it("uses explicit connection options even when the saved startup connection is incomplete", async () => {
  saveSettings({ ...cfg, providers: { custom: {} } });
  agent = createAgent({ cwd: root, sessionsRoot: join(root, "sessions"), settings: cfg });
  await agent.prompt("Use the provided connection");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.body.model).toBe("fixture-one");
});

it("restores conversation history with the currently saved connection after a restart", async () => {
  agent = createAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  await agent.prompt("Retain this question across restart");
  const metadata = await agent.getSessionMetadata();
  cfg.model = "fixture-after-restart";
  cfg.providers!.custom!.apiKey = "restart-key";
  saveSettings(cfg);
  await agent.waitForIdle();
  agent = createAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  await agent.resumeSession(metadata!.id);
  await agent.prompt("Continue after restart");
  expect(requests[1]).toMatchObject({ auth: "Bearer restart-key", body: { model: "fixture-after-restart" } });
  expect(JSON.stringify(requests[1]!.body.messages)).toContain("Retain this question across restart");
  expect((await agent.getSessionMetadata())?.id).toBe(metadata!.id);
});

it.each(["ok", "empty", "unauthorized", "timeout"] as const)("provider smoke reports %s accurately for scoped settings", async responseMode => {
  mode = responseMode;
  const smoke = buildSettingsCase(cfg);
  expect(smoke).not.toBeNull();
  const result = await runCase(smoke!, PROBE_TIMEOUT_MS);
  expect(result.ok).toBe(responseMode === "ok");
  expect(requests).toHaveLength(1);
  if (responseMode === "empty") expect(result.error).toContain("no assistant text");
  if (responseMode === "unauthorized") expect(result.error).toContain("Unauthorized");
  if (responseMode === "timeout") expect(result.error).toContain("timed out");
  expect(JSON.stringify(result)).not.toContain("fixture-secret");
  expect(process.env.OHQUANT_DIR).toBe(root);
}, PROBE_TEST_TIMEOUT_MS);

it("recovers an invalid startup configuration after saving from Settings", async () => {
  const models: string[] = [];
  const runtime = new AppRuntime({ onMessages: () => {}, onActivity: () => {}, onModel: snapshot => { models.push(snapshot.model); } }, async () => [], async () => []);
  saveSettings({ ...cfg, providers: { custom: {} } });
  try {
    const invalid = await collectDoctor(loadSettings(), {}, { phases: ["model"], writeLog: false });
    expect(invalid.phases[0].status).toBe("fail");
    expect(invalid.phases[0].error).toContain("base URL");
    await expect(runtime.bootstrap()).rejects.toThrow("base URL");
    saveSettings({ ...cfg, revision: loadSettings().revision });
    runtime.refreshConfiguration();
    await runtime.submit("Verify repaired connection");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body.model).toBe("fixture-one");
    expect(models).toContain("fixture-one");
  } finally {
    runtime.dispose();
  }
});
