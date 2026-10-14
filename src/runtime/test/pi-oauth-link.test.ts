import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { OAuthCredential, Provider } from "@earendil-works/pi-ai";
import { lock, lockSync } from "proper-lockfile";
import { getModels, getProvider } from "../../agent/src/kernel/llm.ts";
import { resolveModelOAuth } from "../../agent/src/model-oauth.ts";
import { readSettings, saveSettings } from "../../storage/index.ts";
import { inspectPiConnections, inspectPiImport } from "../models/pi-config-import.ts";
import { signOutModelConnection } from "../models/model-oauth.ts";
import { modelAuthLabel } from "../models/model-settings.ts";

let root: string, piDir: string, previous: string | undefined;
const token = (access: string, expires = Date.now() + 30 * 60_000): OAuthCredential =>
  ({ type: "oauth", access, refresh: `refresh-${access}`, expires });

beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-pi-oauth-link-"));
  piDir = join(root, "pi agent"); mkdirSync(piDir);
  process.env.OHQUANT_DIR = join(root, "whyj");
  writeFileSync(join(piDir, "models.json"), JSON.stringify({ providers: {} }));
  writeFileSync(join(piDir, "auth.json"), JSON.stringify({ "openai-codex": token("codex-secret"),
    anthropic: token("expired-secret", 0), unrelated: { type: "api_key", key: "keep-unrelated" } }));
  writeFileSync(join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "openai-codex", defaultModel: getModels("openai-codex")[0]!.id }));
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected Pi OAuth fixture root.");
  rmSync(root, { recursive: true, force: true });
});

it("previews and links a Pi OAuth-only provider without copying tokens or changing Pi auth.json", async () => {
  const authPath = join(piDir, "auth.json"), sourceBefore = readFileSync(authPath, "utf8");
  const listed = inspectPiConnections(piDir);
  expect(listed.find(item => item.provider === "openai-codex")?.credential).toContain("preview checks link eligibility");
  expect(JSON.stringify(listed)).not.toContain("codex-secret");
  const preview = inspectPiImport({ directory: piDir });
  expect(preview.credential).toContain("Pi OAuth");
  expect(JSON.stringify(preview)).not.toContain("codex-secret");
  expect(readSettings().revision).toBe("missing");
  expect(inspectPiImport({ directory: piDir }, preview.review).applied).toBe(true);
  const saved = readSettings(), id = saved.providers!["openai-codex"]!.oauthId!;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(saved.provider).toBe("openai-codex");
  expect(readFileSync(join(root, "whyj", "settings.json"), "utf8")).not.toContain("codex-secret");
  expect(readFileSync(join(root, "whyj", "model-auth", `${id}.json`), "utf8")).not.toContain("codex-secret");
  expect(readFileSync(authPath, "utf8")).toBe(sourceBefore);
  expect(await modelAuthLabel(saved)).toContain("Pi OAuth linked");
  await signOutModelConnection(saved);
  expect(existsSync(join(root, "whyj", "model-auth", `${id}.json`))).toBe(false);
  expect(readFileSync(authPath, "utf8")).toBe(sourceBefore);
  await expect(resolveModelOAuth("openai-codex", id)).rejects.toThrow("Sign in again");
});

it("uses the shared Pi file lock for a single refresh and preserves other providers", async () => {
  const selection = { directory: piDir, provider: "anthropic", model: getModels("anthropic")[0]!.id };
  const preview = inspectPiImport(selection);
  inspectPiImport(selection, preview.review);
  const id = readSettings().providers!.anthropic!.oauthId!;
  let refreshes = 0;
  const fixture: Provider = { ...getProvider("anthropic")!, auth: { oauth: {
    name: "Fixture OAuth", login: async () => token("new-login"),
    refresh: async () => { refreshes++; await Bun.sleep(25); return token("rotated-secret"); },
    toAuth: async current => ({ apiKey: current.access }),
  } } };
  const results = await Promise.all(Array.from({ length: 6 }, () => resolveModelOAuth("anthropic", id, undefined, undefined, fixture)));
  expect(refreshes).toBe(1);
  expect(results.every(result => result.auth.apiKey === "rotated-secret")).toBe(true);
  const auth = JSON.parse(readFileSync(join(piDir, "auth.json"), "utf8")) as Record<string, { access?: string; refresh?: string; key?: string }>;
  expect(auth.anthropic).toMatchObject({ access: "rotated-secret", refresh: "refresh-rotated-secret" });
  expect(auth["openai-codex"]!.access).toBe("codex-secret");
  expect(auth.unrelated!.key).toBe("keep-unrelated");
});

it("rotates a linked Pi account once across four independent OAuth workers", async () => {
  const authPath = join(piDir, "auth.json"), auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
  auth.anthropic = token("expired", 0);
  writeFileSync(authPath, JSON.stringify(auth));
  const selection = { directory: piDir, provider: "anthropic", model: getModels("anthropic")[0]!.id };
  inspectPiImport(selection, inspectPiImport(selection).review);
  const localRoot = join(root, "whyj"), id = readSettings().providers!.anthropic!.oauthId!;
  const fixture = join(import.meta.dir, "./fixtures/model-oauth-worker.ts");
  const workers = Array.from({ length: 4 }, (_, index) => Bun.spawn([process.execPath, fixture, localRoot, id, String(index)], {
    stdout: "pipe", stderr: "pipe" }));
  try {
    const deadline = Date.now() + 10_000;
    while (workers.some((_, index) => !existsSync(join(localRoot, `ready-${index}`))) && Date.now() < deadline) {
      if (workers.some(worker => worker.exitCode !== null)) break;
      await Bun.sleep(10);
    }
    expect(workers.every((_, index) => existsSync(join(localRoot, `ready-${index}`)))).toBe(true);
    writeFileSync(join(localRoot, "go"), "go");
    const results = await Promise.all(workers.map(async worker => ({ code: await worker.exited,
      out: await new Response(worker.stdout).text(), err: await new Response(worker.stderr).text() })));
    expect(results).toEqual(Array.from({ length: 4 }, () => ({ code: 0, out: "ready\n", err: "" })));
    expect(readFileSync(join(localRoot, "refresh-count"), "utf8")).toBe("refresh\n");
    const updated = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, { access?: string; key?: string }>;
    expect(updated.anthropic!.access).toBe("process-rotation");
    expect(updated["openai-codex"]!.access).toBe("codex-secret");
    expect(updated.unrelated!.key).toBe("keep-unrelated");
  } finally {
    for (const worker of workers) if (worker.exitCode === null) worker.kill(9);
    await Promise.all(workers.map(worker => worker.exited));
  }
}, 20_000);

it("waits for Pi's auth.json lock and cancels without refreshing or changing its file", async () => {
  const selection = { directory: piDir, provider: "anthropic", model: getModels("anthropic")[0]!.id };
  inspectPiImport(selection, inspectPiImport(selection).review);
  const id = readSettings().providers!.anthropic!.oauthId!, path = join(piDir, "auth.json"), original = readFileSync(path, "utf8");
  let refreshes = 0;
  const fixture: Provider = { ...getProvider("anthropic")!, auth: { oauth: {
    name: "Fixture OAuth", login: async () => token("new-login"),
    refresh: async () => { refreshes++; return token("must-not-run"); },
    toAuth: async current => ({ apiKey: current.access }),
  } } };
  const release = await lock(path, { realpath: false, stale: 30_000 });
  try {
    const controller = new AbortController();
    const pending = resolveModelOAuth("anthropic", id, controller.signal, undefined, fixture);
    await Bun.sleep(60);
    expect(refreshes).toBe(0);
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(readFileSync(path, "utf8")).toBe(original);
  } finally { await release(); }
  expect((await resolveModelOAuth("anthropic", id, undefined, undefined, fixture)).auth.apiKey).toBe("must-not-run");
  expect(refreshes).toBe(1);
});

it("discards an unpublished link when the settings lock rejects apply", () => {
  const settings = readSettings();
  // Establish a durable settings file so a second owner can hold its lock.
  saveSettings(settings);
  const selection = { directory: piDir }, preview = inspectPiImport(selection);
  const piBefore = readFileSync(join(piDir, "auth.json"), "utf8");
  const release = lockSync(join(root, "whyj", "settings.json"), { realpath: false });
  try {
    expect(() => inspectPiImport(selection, preview.review)).toThrow();
    expect(readdirSync(join(root, "whyj", "model-auth"))).toEqual([]);
    expect(readFileSync(join(piDir, "auth.json"), "utf8")).toBe(piBefore);
  } finally { release(); }
  expect(readSettings().providers?.["openai-codex"]?.oauthId).toBeUndefined();
});

it("runs OAuth preview and apply through the headless CLI without printing tokens", async () => {
  const path = join(piDir, "auth.json"), before = readFileSync(path, "utf8");
  const run = async (command: string) => {
    const child = Bun.spawn([process.execPath, "run", "src/index.ts", "--json", "-c", command], {
      cwd: resolve(import.meta.dir, "../../.."), env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
    const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code).toBe(0);
    expect(out + error).not.toContain("codex-secret");
    return JSON.parse(out) as { ok: boolean; data: { review?: string; applied?: boolean; credential?: string } };
  };
  const preview = await run(`/config --pi preview --from "${piDir}"`);
  expect(preview.ok).toBe(true);
  expect(preview.data.credential).toContain("Pi OAuth linked");
  const applied = await run(`/config --pi apply --from "${piDir}" --review ${preview.data.review}`);
  expect(applied.data.applied).toBe(true);
  expect(readSettings().providers?.["openai-codex"]?.oauthId).toBeDefined();
  expect(readFileSync(path, "utf8")).toBe(before);
}, 15000);

it("reuses the same local pointer when a reviewed Pi OAuth connection is imported again", () => {
  const selection = { directory: piDir };
  inspectPiImport(selection, inspectPiImport(selection).review);
  const first = readSettings().providers!["openai-codex"]!.oauthId!;
  inspectPiImport(selection, inspectPiImport(selection).review);
  expect(readSettings().providers!["openai-codex"]!.oauthId).toBe(first);
  expect(readdirSync(join(root, "whyj", "model-auth"))).toEqual([`${first}.json`]);
});
