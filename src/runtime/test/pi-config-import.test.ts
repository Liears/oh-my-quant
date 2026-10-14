import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { inspectPiImport, inspectPiConnections } from "../models/pi-config-import.ts";
import { readSettings, saveSettings, readPiConfigSnapshot } from "../../storage/index.ts";
import { resolveConfiguredAuth, resolveConfiguredModel } from "../../agent/src/model-config.ts";
import { resolvePiKey } from "../../agent/src/pi-config-import.ts";
import { executeCommand, parseCommand } from "../../cli/registry.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";
import { selectModelProvider } from "../models/model-settings.ts";

let root: string, source: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-pi-import-"));
  source = join(root, "pi source"); mkdirSync(source); process.env.OHQUANT_DIR = join(root, "whyj");
  writeFileSync(join(source, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: "http://127.0.0.1:12345/v1", api: "openai-completions", apiKey: "file-secret",
    models: [{ id: "test-model", name: "Test Model", contextWindow: 10000, maxTokens: 500, reasoning: false, input: ["text", "image"], cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 } }] } } }));
  writeFileSync(join(source, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "auth-secret" }, unrelated: { type: "oauth", access: "unrelated-secret" } }));
  writeFileSync(join(source, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "test-model", defaultThinkingLevel: "off" }));
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected Pi import fixture root.");
  rmSync(root, { recursive: true, force: true });
});

it("previews without writes or secrets, then imports exactly the reviewed connection", async () => {
  const before = readPiConfigSnapshot(source);
  const listing = inspectPiConnections(source);
  expect(listing.find(item => item.provider === "unrelated")!.credential).toContain("Pi OAuth");
  const preview = inspectPiImport({ directory: source });
  expect(readSettings().revision).toBe("missing");
  expect(JSON.stringify([listing, preview])).not.toContain("auth-secret");
  expect(JSON.stringify([listing, preview])).not.toContain("file-secret");
  expect(inspectPiImport({ directory: source }, preview.review).applied).toBe(true);
  const saved = readSettings(), model = resolveConfiguredModel(saved);
  expect(model).toMatchObject({ provider: "fixture", id: "test-model", name: "Test Model", input: ["text", "image"], contextWindow: 10000, maxTokens: 500,
    cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 } });
  expect((await resolveConfiguredAuth(saved))!.auth.apiKey).toBe("auth-secret");
  expect(saved.providers!.unrelated).toBeUndefined();
  expect(readPiConfigSnapshot(source)).toEqual(before);
  expect(() => inspectPiImport({ directory: source }, preview.review)).toThrow("stale");
});

it("uses the explicit Pi agent directory environment without scanning unrelated locations", () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = source;
    expect(inspectPiConnections().find(item => item.provider === "fixture")!.models).toEqual(["test-model"]);
    expect(inspectPiImport({}).model).toBe("test-model");
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

it("imports commented models.json with trailing commas while preserving comment-like string values", () => {
  const path = join(source, "models.json");
  const models = '\uFEFF{\r\n// Research connection\r\n"providers": {"fixture": {\r\n' +
    '"api": "openai-completions", "baseUrl": "http://localhost:1234/v1",\r\n' +
    '"headers": {"x-literal": "literal//text/*inside-string*/",},\r\n' +
    '"models": [{"id": "test-model", "name": "A \\"quoted\\" // label",},],\r\n' +
    '},},} // final comment';
  writeFileSync(path, models);
  const preview = inspectPiImport({ directory: source });
  expect(preview.model).toBe("test-model");
  expect(readSettings().revision).toBe("missing");
  inspectPiImport({ directory: source }, preview.review);
  expect(readSettings().providers!.fixture!.headers).toEqual({ "x-literal": "literal//text/*inside-string*/" });
  expect(resolveConfiguredModel(readSettings()).name).toBe('A "quoted" // label');
  expect(readFileSync(path, "utf8")).toBe(models);
});

it("invalidates review after comment-only source edits and retains the previous settings", () => {
  const path = join(source, "models.json"), original = readFileSync(path, "utf8");
  writeFileSync(path, "// initial comment\n" + original);
  const preview = inspectPiImport({ directory: source });
  writeFileSync(path, "// changed comment\n" + original);
  expect(() => inspectPiImport({ directory: source }, preview.review)).toThrow("stale");
  expect(readSettings().revision).toBe("missing");
});

it.each(["auth.json", "settings.json"])("keeps %s strict JSON rather than silently accepting model-file syntax", name => {
  const path = join(source, name), original = "// not supported here\n" + readFileSync(path, "utf8");
  writeFileSync(path, original);
  expect(() => inspectPiImport({ directory: source })).toThrow(`Invalid Pi ${name}`);
  expect(readFileSync(path, "utf8")).toBe(original);
  expect(readSettings().revision).toBe("missing");
});

it.each(['{"providers": { /* unclosed comment', '{"providers": "unclosed', '{"providers":,}'])("preserves malformed commented model files without exposing their content", malformed => {
  const path = join(source, "models.json"); writeFileSync(path, malformed);
  expect(() => inspectPiImport({ directory: source })).toThrow("Invalid Pi models.json");
  expect(readFileSync(path, "utf8")).toBe(malformed);
  expect(readSettings().revision).toBe("missing");
});

it("rejects source and settings changes, preserving the current usable configuration", () => {
  const cfg = readSettings(); cfg.env.WHYJ_QUANT_TUSHARE_TOKEN = "keep-me"; saveSettings(cfg);
  const preview = inspectPiImport({ directory: source });
  cfg.showPortfolioPanel = false; saveSettings(cfg);
  expect(() => inspectPiImport({ directory: source }, preview.review)).toThrow("stale");
  const next = inspectPiImport({ directory: source });
  writeFileSync(join(source, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "changed" } }));
  expect(() => inspectPiImport({ directory: source }, next.review)).toThrow("stale");
  expect(readSettings()).toMatchObject({ showPortfolioPanel: false, env: { WHYJ_QUANT_TUSHARE_TOKEN: "keep-me" } });
});

it("maps known model overrides with native provider identity and preserves unrelated settings", () => {
  writeFileSync(join(source, "models.json"), JSON.stringify({ providers: { deepseek: { modelOverrides: { "deepseek-v4-pro": { contextWindow: 1000000 } } } } }));
  writeFileSync(join(source, "auth.json"), JSON.stringify({ deepseek: { type: "api_key", key: "native-secret" } }));
  const selection = { directory: source, provider: "deepseek", model: "deepseek-v4-pro" };
  const cfg = readSettings(); cfg.disabledExtensions = ["fixture.disabled"]; cfg.providers = { custom: { apiKey: "keep-custom" } }; saveSettings(cfg);
  const preview = inspectPiImport(selection); inspectPiImport(selection, preview.review);
  expect(readSettings()).toMatchObject({ provider: "deepseek", disabledExtensions: ["fixture.disabled"], providers: { custom: { apiKey: "keep-custom" } } });
  expect(resolveConfiguredModel(readSettings()).contextWindow).toBe(1000000);
});

it("implements Pi literal/interpolation semantics without running commands or guessing variable names", () => {
  expect(resolvePiKey("MY_KEY", { MY_KEY: "secret" })).toBe("MY_KEY");
  expect(resolvePiKey("prefix-${A}_$B", { A: "one", B: "two" })).toBe("prefix-one_two");
  expect(resolvePiKey("$$A-$!echo", {})).toBe("$A-!echo");
  expect(() => resolvePiKey("$MISSING", {})).toThrow("unresolved");
  expect(() => resolvePiKey("!echo DO_NOT_EXECUTE", {})).toThrow("Command");
});

it("invalidates an import preview when an interpolated credential changes", () => {
  const previous = process.env.WHYJ_PI_IMPORT_TEST_KEY;
  writeFileSync(join(source, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "$WHYJ_PI_IMPORT_TEST_KEY", env: { WHYJ_PI_IMPORT_TEST_KEY: "" } } }));
  try {
    process.env.WHYJ_PI_IMPORT_TEST_KEY = "first";
    const preview = inspectPiImport({ directory: source });
    process.env.WHYJ_PI_IMPORT_TEST_KEY = "second";
    expect(() => inspectPiImport({ directory: source }, preview.review)).toThrow("stale");
    expect(readSettings().revision).toBe("missing");
  } finally {
    if (previous === undefined) delete process.env.WHYJ_PI_IMPORT_TEST_KEY; else process.env.WHYJ_PI_IMPORT_TEST_KEY = previous;
  }
});

it("invalidates header snapshots when their environment changes without exposing header secrets", () => {
  const previous = process.env.WHYJ_PI_HEADER_TEST;
  const parsed = JSON.parse(readFileSync(join(source, "models.json"), "utf8"));
  parsed.providers.fixture.headers = { "x-tenant": "$WHYJ_PI_HEADER_TEST" };
  writeFileSync(join(source, "models.json"), JSON.stringify(parsed));
  try {
    process.env.WHYJ_PI_HEADER_TEST = "first-header-secret";
    const preview = inspectPiImport({ directory: source });
    expect(JSON.stringify(preview)).not.toContain("header-secret");
    process.env.WHYJ_PI_HEADER_TEST = "second-header-secret";
    expect(() => inspectPiImport({ directory: source }, preview.review)).toThrow("stale");
    expect(readSettings().revision).toBe("missing");
    inspectPiImport({ directory: source }, inspectPiImport({ directory: source }).review);
    expect(readSettings().providers!.fixture!.headers).toEqual({ "x-tenant": "second-header-secret" });
  } finally {
    if (previous === undefined) delete process.env.WHYJ_PI_HEADER_TEST; else process.env.WHYJ_PI_HEADER_TEST = previous;
  }
});

it("runs list/preview/apply through the actual headless CLI without exposing imported keys", async () => {
  const cfg = readSettings(); saveSettings(cfg);
  const run = async (command: string) => {
    const child = Bun.spawn([process.execPath, "run", "src/index.ts", "--json", "-c", command], {
      cwd: resolve(import.meta.dir, "../../.."), env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
    const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code).toBe(0); expect(error).not.toContain("auth-secret"); expect(output).not.toContain("auth-secret");
    return JSON.parse(output) as { ok: boolean; data: { review?: string; applied?: boolean } };
  };
  expect((await run(`/config --pi list --from "${source}"`)).ok).toBe(true);
  const preview = await run(`/config --pi preview --from "${source}"`);
  expect(preview.ok).toBe(true);
  expect((await run(`/config --pi apply --from "${source}" --review ${preview.data.review}`)).data.applied).toBe(true);
  expect(readSettings().model).toBe("test-model");
}, 15000);

it.each(["oauth", "command", "compat", "malformed", "duplicate", "missing-model", "bad-capability"])("rejects %s rather than silently changing its meaning", mode => {
  if (mode === "oauth") writeFileSync(join(source, "auth.json"), JSON.stringify({ fixture: { type: "oauth", access: "DO_NOT_LEAK", refresh: "DO_NOT_LEAK" } }));
  if (mode === "command") writeFileSync(join(source, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "!echo DO_NOT_LEAK" } }));
  if (mode === "malformed") writeFileSync(join(source, "auth.json"), '{"key":"DO_NOT_LEAK');
  if (["compat", "duplicate", "missing-model", "bad-capability"].includes(mode)) {
    const parsed = JSON.parse(readFileSync(join(source, "models.json"), "utf8"));
    const provider = parsed.providers.fixture;
    if (mode === "compat") provider.compat = { unsupportedSetting: false };
    if (mode === "duplicate") provider.models.push(provider.models[0]);
    if (mode === "missing-model") provider.models = [];
    if (mode === "bad-capability") provider.models[0].contextWindow = -1;
    writeFileSync(join(source, "models.json"), JSON.stringify(parsed));
  }
  let error: unknown;
  try { inspectPiImport({ directory: source }); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain("DO_NOT_LEAK");
  expect(readSettings().revision).toBe("missing");
});

it("exposes preview/apply through slash parsing, including quoted Windows paths and cancellation", async () => {
  const command = `/config --pi preview --from "${source}"`;
  expect(parseCommand(command)!.flags.from).toBe(source);
  let opens = 0;
  const preview = await executeCommand(parseCommand(command)!, { openConfig: () => { opens++; } });
  expect(preview.success).toBe(true); expect(opens).toBe(0);
  const review = (preview.data as { review: string }).review;
  const apply = parseCommand(`/config --pi apply --from "${source}" --review ${review}`)!;
  expect((await executeCommand(apply, { commandSignal: AbortSignal.abort() })).success).toBe(false);
  expect(readSettings().revision).toBe("missing");
  expect((await executeCommand(apply)).success).toBe(true);
  for (const invalid of ["/config --pi apply", "/config --pi preview --review bad", "/config --pi list --extensions list", "/config --pi list --provider deepseek"]) {
    expect((await executeCommand(parseCommand(invalid)!)).success).toBe(false);
  }
});

it("uses the imported endpoint and auth in real Pi requests while retaining the existing session", async () => {
  const requests: Array<{ key: string | null; model: unknown; path: string }> = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    const payload = await incoming.json() as { model: unknown }; requests.push({ key: incoming.headers.get("authorization"), model: payload.model, path: new URL(incoming.url).pathname });
    return new Response('data: {"id":"fixture","object":"chat.completion.chunk","created":0,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"fixture"},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","created":0,"model":"test-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
  } });
  const cfg = readSettings(); cfg.provider = "custom"; cfg.model = "old-model"; cfg.thinkingLevel = "off";
  cfg.providers = { custom: { api: "openai-completions", baseUrl: `${server.url}v1`, apiKey: "old-secret" } }; saveSettings(cfg);
  const agent = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  const proxy = process.env.NO_PROXY; process.env.NO_PROXY = "127.0.0.1,localhost";
  try {
    await agent.prompt("First fixture request"); const id = (await agent.getSessionMetadata())!.id;
    const parsed = JSON.parse(readFileSync(join(source, "models.json"), "utf8")); parsed.providers.fixture.baseUrl = `${server.url}v1`;
    writeFileSync(join(source, "models.json"), JSON.stringify(parsed));
    const preview = inspectPiImport({ directory: source }); inspectPiImport({ directory: source }, preview.review);
    await agent.prompt("Second fixture request");
    parsed.providers.lab = { ...parsed.providers.fixture, baseUrl: `${server.url}lab/v1`, apiKey: "lab-secret" };
    parsed.providers.fixture.models.push({ id: "second-model", contextWindow: 10000, maxTokens: 500 });
    writeFileSync(join(source, "models.json"), JSON.stringify(parsed));
    const lab = { directory: source, provider: "lab", model: "test-model" };
    inspectPiImport(lab, inspectPiImport(lab).review);
    await agent.prompt("Third fixture request");
    const second = { directory: source, provider: "fixture", model: "second-model" };
    inspectPiImport(second, inspectPiImport(second).review);
    await agent.prompt("Fourth fixture request");
    const saved = readSettings(); saved.model = "test-model"; saveSettings(saved);
    await agent.prompt("Fifth fixture request");
    const switched = readSettings(); selectModelProvider(switched, "custom"); saveSettings(switched);
    await agent.prompt("Sixth fixture request");
    expect((await agent.getSessionMetadata())!.id).toBe(id);
    expect(Object.keys(readSettings().providers!.fixture!.models!)).toEqual(["test-model", "second-model"]);
    expect(requests).toEqual([
      { key: "Bearer old-secret", model: "old-model", path: "/v1/chat/completions" },
      { key: "Bearer auth-secret", model: "test-model", path: "/v1/chat/completions" },
      { key: "Bearer lab-secret", model: "test-model", path: "/lab/v1/chat/completions" },
      { key: "Bearer auth-secret", model: "second-model", path: "/v1/chat/completions" },
      { key: "Bearer auth-secret", model: "test-model", path: "/v1/chat/completions" },
      { key: "Bearer old-secret", model: "old-model", path: "/v1/chat/completions" },
    ]);
    expect((await agent.getSessionBranch()).filter(entry => entry.type === "message").length).toBeGreaterThanOrEqual(12);
  } finally {
    agent.abort(); server.stop(true); await agent.waitForIdle();
    if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  }
});
