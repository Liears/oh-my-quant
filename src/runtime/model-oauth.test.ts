import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { OAuthCredential, Provider, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { ModelOAuthFile, readSettings, saveSettings } from "../storage/index.ts";
import { getProvider, getModels } from "../agent/src/kernel/llm.ts";
import { loginModelOAuth, resolveModelOAuth } from "../agent/src/model-oauth.ts";
import { signInModelConnection, signOutModelConnection } from "./model-oauth.ts";
import { modelAuthLabel } from "./model-settings.ts";

let root: string, previous: string | undefined;
// Pi refreshes within five minutes of expiry; successful fixtures must outlive that window.
const token = (access = "fixture-access", expires = Date.now() + 30 * 60000): OAuthCredential => ({ type: "oauth", access, refresh: `refresh-${access}`, expires });
beforeEach(() => { previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-oauth-")); process.env.OHQUANT_DIR = root; });
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected OAuth fixture root.");
  rmSync(root, { recursive: true, force: true });
});

function provider(overrides: Partial<NonNullable<Provider["auth"]["oauth"]>> = {}): Provider {
  return { ...getProvider("anthropic")!, auth: {
    apiKey: { name: "Must not fall back", resolve: async () => { throw new Error("API-key fallback must not execute"); } },
    oauth: { name: "Fixture OAuth", login: async interaction => token(await interaction.prompt({ type: "secret", message: "Fixture account" })),
      refresh: async () => token("refreshed-access"), toAuth: async current => ({ apiKey: current.access, baseUrl: "http://localhost:1234/v1", headers: { "x-account": "fixture", "x-remove": null } }),
      ...overrides,
    },
  } };
}
function interaction(signal = new AbortController().signal): ProviderAuthInteraction {
  return { signal, prompt: async () => "login-access", notify: () => {} };
}
function settings() {
  const cfg = readSettings(); cfg.provider = "anthropic"; cfg.model = getModels("anthropic")[0]!.id;
  cfg.providers = { anthropic: { apiKey: "keep-api-key" } }; saveSettings(cfg); return cfg;
}

it("stores opaque login generations separately and preserves Pi-derived headers and account endpoint", async () => {
  const first = await loginModelOAuth("anthropic", interaction(), root, provider());
  const second = await loginModelOAuth("anthropic", { ...interaction(), prompt: async () => "second-account" }, root, provider());
  expect(first.id).not.toBe(second.id);
  const auth = await resolveModelOAuth("anthropic", first.id, undefined, root, provider());
  expect(auth.auth).toEqual({ apiKey: "login-access", baseUrl: "http://localhost:1234/v1", headers: { "x-account": "fixture", "x-remove": null } });
  expect((await resolveModelOAuth("anthropic", second.id, undefined, root, provider())).auth.apiKey).toBe("second-account");
  expect(readSettings().revision).toBe("missing");
});

it("uses Pi refresh once for concurrent expired-token requests", async () => {
  const file = ModelOAuthFile.create("anthropic", token("expired", 0)); let refreshes = 0;
  const p = provider({ refresh: async current => { expect(current.access).toBe("expired"); refreshes++; await Bun.sleep(40); return token("rotated"); } });
  const results = await Promise.all(Array.from({ length: 8 }, () => resolveModelOAuth("anthropic", file.id, undefined, root, p)));
  expect(refreshes).toBe(1); expect(results.every(result => result.auth.apiKey === "rotated")).toBe(true);
  expect(file.read()!.refresh).toBe("refresh-rotated");
});

it("rotates a shared token only once across four independent CLI processes", async () => {
  const file = ModelOAuthFile.create("anthropic", token("expired", 0));
  const fixture = join(import.meta.dir, "fixtures", "model-oauth-worker.ts");
  const workers = Array.from({ length: 4 }, (_, index) => Bun.spawn([process.execPath, fixture, root, file.id, String(index)], { stdout: "pipe", stderr: "pipe" }));
  try {
    const deadline = Date.now() + 10000;
    while (workers.some((_, index) => !existsSync(join(root, `ready-${index}`))) && Date.now() < deadline) {
      if (workers.some(worker => worker.exitCode !== null)) break;
      await Bun.sleep(10);
    }
    expect(workers.every((_, index) => existsSync(join(root, `ready-${index}`)))).toBe(true);
    writeFileSync(join(root, "go"), "go");
    const outcomes = await Promise.all(workers.map(async worker => ({ code: await worker.exited, out: await new Response(worker.stdout).text(), err: await new Response(worker.stderr).text() })));
    expect(outcomes).toEqual(Array.from({ length: 4 }, () => ({ code: 0, out: "ready\n", err: "" })));
    expect(readFileSync(join(root, "refresh-count"), "utf8")).toBe("refresh\n");
    expect(file.read()!.access).toBe("process-rotation");
  } finally {
    for (const worker of workers) if (worker.exitCode === null) worker.kill(9);
    await Promise.all(workers.map(worker => worker.exited));
  }
}, 20000);

it("retains original bytes on refresh failure and does not expose provider error secrets", async () => {
  const file = ModelOAuthFile.create("anthropic", token("expired", 0)), path = join(root, "model-auth", `${file.id}.json`);
  const before = readFileSync(path, "utf8");
  let error: unknown;
  try { await resolveModelOAuth("anthropic", file.id, undefined, root, provider({ refresh: async () => { throw new Error("private-refresh-secret"); } })); } catch (caught) { error = caught; }
  expect(String(error)).toContain("refresh failed"); expect(String(error)).not.toContain("private-refresh-secret");
  expect(readFileSync(path, "utf8")).toBe(before);
});

it("preserves credentials after a refresh process crashes and recovers an aged abandoned lease", async () => {
  const file = ModelOAuthFile.create("anthropic", token("expired", 0)), path = join(root, "model-auth", `${file.id}.json`);
  const original = readFileSync(path, "utf8");
  const worker = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "model-oauth-crash-worker.ts"), root, file.id], { stdout: "pipe", stderr: "pipe" });
  try {
    const deadline = Date.now() + 10000;
    while (!existsSync(join(root, "refresh-entered")) && worker.exitCode === null && Date.now() < deadline) await Bun.sleep(10);
    expect(existsSync(join(root, "refresh-entered"))).toBe(true);
    expect(existsSync(`${path}.lock`)).toBe(true);
    worker.kill(9);
    expect(await worker.exited).not.toBe(0);
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(existsSync(`${path}.lock`)).toBe(true);

    // Simulate passage beyond the 90-second stale threshold after confirmed process exit.
    // This does not claim recovery of a token already rotated by a remote provider.
    const stale = new Date(Date.now() - 120000);
    utimesSync(`${path}.lock`, stale, stale);
    let refreshes = 0;
    const p = provider({ refresh: async current => {
      expect(current.access).toBe("expired"); refreshes++; return token("crash-recovery");
    } });
    const results = await Promise.all(Array.from({ length: 4 }, () => resolveModelOAuth("anthropic", file.id, undefined, root, p)));
    expect(refreshes).toBe(1);
    expect(results.every(result => result.auth.apiKey === "crash-recovery")).toBe(true);
    expect(file.read()!.refresh).toBe("refresh-crash-recovery");
    expect(existsSync(`${path}.lock`)).toBe(false);
    expect(readdirSync(join(root, "model-auth"))).toEqual([`${file.id}.json`]);
  } finally {
    if (worker.exitCode === null) worker.kill(9);
    await worker.exited;
    await Promise.all([new Response(worker.stdout).text(), new Response(worker.stderr).text()]);
  }
}, 20000);

it("rejects a late credential update after a real heartbeat detects lease loss", async () => {
  const file = ModelOAuthFile.create("anthropic", token("expired", 0)), path = join(root, "model-auth", `${file.id}.json`);
  const original = readFileSync(path, "utf8");
  await expect(file.modify(async current => {
    expect(current!.access).toBe("expired");
    // A changed lock timestamp indicates that this lease is no longer ours.
    const replacementTime = new Date(Date.now() + 120000);
    utimesSync(`${path}.lock`, replacementTime, replacementTime);
    await Bun.sleep(6500); // Exercise the real five-second heartbeat, without mocked timers.
    return token("must-not-commit");
  })).rejects.toThrow("lease was lost");
  expect(readFileSync(path, "utf8")).toBe(original);
  // A compromised holder must not release a lock which may now belong to another process.
  expect(existsSync(`${path}.lock`)).toBe(true);
}, 15000);

it("cancels lock waiting without executing a second refresh", async () => {
  const file = ModelOAuthFile.create("anthropic", token("expired", 0));
  let enter!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { finish = resolve; });
  let calls = 0;
  const p = provider({ refresh: async () => { calls++; enter(); await gate; return token("rotated"); } });
  const first = resolveModelOAuth("anthropic", file.id, undefined, root, p); await entered;
  const controller = new AbortController(); const waiting = resolveModelOAuth("anthropic", file.id, controller.signal, root, p);
  controller.abort(); await expect(waiting).rejects.toThrow("cancelled");
  finish(); await first; expect(calls).toBe(1);
});

it("preserves a confirmed token rotation when the requesting turn is cancelled late", async () => {
  const file = ModelOAuthFile.create("anthropic", token("expired", 0)), controller = new AbortController();
  const p = provider({ refresh: async () => { controller.abort(); return token("confirmed-rotation"); } });
  await expect(resolveModelOAuth("anthropic", file.id, controller.signal, root, p)).rejects.toThrow("cancelled");
  expect(file.read()!.access).toBe("confirmed-rotation");
});

it("serializes logout after refresh and never resurrects deleted credentials or uses an API key", async () => {
  const file = ModelOAuthFile.create("anthropic", token("expired", 0));
  let enter!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { finish = resolve; });
  const p = provider({ refresh: async () => { enter(); await gate; return token("rotated"); } });
  const request = resolveModelOAuth("anthropic", file.id, undefined, root, p); await entered;
  const logout = file.delete(); finish(); await request; await logout;
  expect(file.read()).toBeUndefined();
  await expect(resolveModelOAuth("anthropic", file.id, undefined, root, p)).rejects.toThrow("Sign in again");
  let called = false; await file.modify(async () => { called = true; return token(); }); expect(called).toBe(false);
});

it("rejects cross-provider references, invalid IDs and malformed files without overwriting them", async () => {
  const file = ModelOAuthFile.create("anthropic", token()), path = join(root, "model-auth", `${file.id}.json`);
  expect(() => new ModelOAuthFile("anthropic", "../settings")).toThrow("reference");
  expect(() => new ModelOAuthFile("openai-codex", file.id).read()).toThrow("invalid");
  writeFileSync(path, '{"access":"private-file-secret"');
  await expect(resolveModelOAuth("anthropic", file.id, undefined, root, provider())).rejects.toThrow("Sign in again");
  expect(readFileSync(path, "utf8")).toBe('{"access":"private-file-secret"');
});

it("does not save cancelled or failed sign-ins", async () => {
  const controller = new AbortController();
  const p = provider({ login: async () => { controller.abort(); return token(); } });
  await expect(loginModelOAuth("anthropic", interaction(controller.signal), root, p)).rejects.toThrow("cancelled");
  await expect(loginModelOAuth("anthropic", interaction(), root, provider({ login: async () => { throw new Error("private-login-secret"); } }))).rejects.toThrow("OAuth sign-in failed");
  expect(readdirSync(root)).toEqual([]);
});

it("commits an explicit sign-in and leaves OAuth selected after logout instead of falling back", async () => {
  const cfg = settings();
  const saved = await signInModelConnection(cfg, interaction(), (id, ui, dir) => loginModelOAuth(id, ui, dir, provider()));
  const id = saved.providers!.anthropic!.oauthId!;
  expect(id).toBeDefined(); expect(readSettings().providers!.anthropic!.oauthId).toBe(id);
  expect(readFileSync(join(root, "settings.json"), "utf8")).not.toContain("login-access");
  await signOutModelConnection(saved);
  expect(new ModelOAuthFile("anthropic", id).read()).toBeUndefined();
  expect(readSettings().providers!.anthropic).toMatchObject({ oauthId: id, apiKey: "keep-api-key" });
});

it("cleans up a completed login when a concurrent settings edit wins", async () => {
  const cfg = settings();
  await expect(signInModelConnection(cfg, interaction(), async (id, ui, dir) => {
    const file = await loginModelOAuth(id, ui, dir, provider());
    const other = readSettings(); other.showPortfolioPanel = false; saveSettings(other); return file;
  })).rejects.toThrow("changed");
  expect(readSettings().providers!.anthropic!.oauthId).toBeUndefined();
  expect(readSettings().showPortfolioPanel).toBe(false);
  expect(readdirSync(join(root, "model-auth"))).toEqual([]);
});

it("shows OAuth status without refreshing credentials merely to render the editor", async () => {
  const cfg = settings(), file = ModelOAuthFile.create("anthropic", token("expired", 0));
  cfg.providers!.anthropic!.oauthId = file.id;
  const path = join(root, "model-auth", `${file.id}.json`), original = readFileSync(path, "utf8");
  expect(await modelAuthLabel(cfg)).toBe("OAuth saved · refresh required on next request");
  expect(readFileSync(path, "utf8")).toBe(original);
  await file.delete();
  expect(await modelAuthLabel(cfg)).toBe("OAuth signed out · sign in again");
});

it("rejects malformed persisted OAuth references instead of silently selecting a saved API key", () => {
  const cfg = settings(), path = join(root, "settings.json");
  for (const oauthId of ["", "../other", 0, null, {}]) {
    const invalid = JSON.stringify({ ...cfg, providers: { anthropic: { apiKey: "fixture", oauthId } } });
    writeFileSync(path, invalid);
    expect(() => readSettings()).toThrow();
    expect(readFileSync(path, "utf8")).toBe(invalid);
  }
});
