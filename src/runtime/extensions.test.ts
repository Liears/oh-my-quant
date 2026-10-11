import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { RuntimeExtensions } from "./extensions.ts";
import { statisticsExtension } from "../extensions/test/fixtures/statistics-extension.ts";
import { loadSettings, saveSettings } from "../storage/index.ts";
import { executeCommand, parseCommand } from "../cli/registry.ts";
import type { ExtensionDefinition } from "../extensions/index.ts";

let root: string, previous: string | undefined;
const runtimes: RuntimeExtensions[] = [];
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-extension-runtime-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()));
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  const within = relative(realpathSync(tmpdir()), realpathSync(root));
  if (!within.startsWith("whyj-extension-runtime-") || within.includes(sep)) throw new Error("Unsafe cleanup");
  rmSync(root, { recursive: true, force: true });
});

function runtime(definitions: ExtensionDefinition[], save?: typeof saveSettings) {
  const result = new RuntimeExtensions({ cwd: root, definitions, saveSettings: save });
  runtimes.push(result); return result;
}

it("persists disabled choices across restarts without activating disabled modules and retains unavailable IDs", async () => {
  let activations = 0;
  const original = statisticsExtension();
  const definition = { ...original, activate: () => { activations++; return original.activate({ apiVersion: 1, cwd: root, signal: new AbortController().signal, report() {} }); } };
  const settings = loadSettings(); settings.disabledExtensions = ["fixture.missing"]; saveSettings(settings);
  const first = runtime([definition]);
  await first.start(); expect(activations).toBe(1);
  expect((await first.manage("disable", "fixture.statistics")).success).toBe(true);
  expect(loadSettings().disabledExtensions).toEqual(["fixture.missing", "fixture.statistics"]);
  await first.dispose();
  const second = runtime([definition]); await second.start();
  expect(activations).toBe(1); expect(second.host.snapshot().tools).toHaveLength(0);
  expect((await second.manage("list")).data).toMatchObject({ unavailable: ["fixture.missing"], extensions: [{ enabled: false, configuredEnabled: false }] });
  expect((await second.manage("enable", "fixture.statistics")).success).toBe(true);
  expect(activations).toBe(2);
  expect((await second.manage("reload", "fixture.statistics")).success).toBe(true);
  expect(activations).toBe(3);
  expect(loadSettings().disabledExtensions).toEqual(["fixture.missing"]);
});

it("keeps other extensions usable after startup failure and retries the failed module explicitly", async () => {
  let fail = true;
  const broken: ExtensionDefinition = { manifest: { id: "fixture.broken", version: "1.0.0", apiVersion: 1, tools: [], skills: [], commands: [] },
    activate() { if (fail) throw new Error("Fixture could not connect"); return { tools: [], skills: [], commands: [] }; } };
  const manager = runtime([broken, statisticsExtension()]);
  await manager.start();
  expect(manager.host.snapshot().tools.map(tool => tool.name)).toEqual(["fixture_mean"]);
  expect(manager.startupErrors.join()).toContain("Fixture could not connect");
  expect((await manager.manage("list")).message).toContain("failed");
  const before = readFileSync(join(root, "settings.json"), "utf8");
  expect((await manager.manage("enable", "fixture.broken")).success).toBe(false);
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe(before);
  fail = false;
  expect((await manager.manage("enable", "fixture.broken")).success).toBe(true);
  expect(manager.startupErrors).toEqual([]);
});

it("reports an incompatible compiled extension without preventing compatible modules from starting", async () => {
  let activated = false;
  const incompatible: ExtensionDefinition = { manifest: { id: "fixture.future", version: "2.0.0", apiVersion: 2, tools: [], skills: [], commands: [] },
    activate() { activated = true; return { tools: [], skills: [], commands: [] }; } };
  const manager = runtime([incompatible, statisticsExtension()]);
  await manager.start();
  expect(activated).toBe(false);
  expect(manager.host.snapshot().tools.map(tool => tool.name)).toEqual(["fixture_mean"]);
  expect(manager.startupErrors.join()).toContain("API");
  expect((await manager.manage("enable", "fixture.future")).success).toBe(false);
  expect(loadSettings().disabledExtensions).toBeUndefined();
});

it("restores live state when settings cannot commit and preserves a concurrent settings edit", async () => {
  let conflict = false;
  let edits = 0;
  const manager = runtime([statisticsExtension()], settings => {
    if (conflict) { const other = loadSettings(); other.model = `concurrent-model-${++edits}`; saveSettings(other); }
    saveSettings(settings);
  });
  await manager.start(); conflict = true;
  expect((await manager.manage("disable", "fixture.statistics")).success).toBe(false);
  expect(manager.host.snapshot().tools.map(tool => tool.name)).toEqual(["fixture_mean"]);
  expect(loadSettings().disabledExtensions).toBeUndefined();
  expect(loadSettings().model).toBe("concurrent-model-1");
  conflict = false;
  expect((await manager.manage("disable", "fixture.statistics")).success).toBe(true);
  conflict = true;
  expect((await manager.manage("enable", "fixture.statistics")).success).toBe(false);
  expect(manager.host.snapshot().tools).toEqual([]);
  expect(loadSettings().disabledExtensions).toEqual(["fixture.statistics"]);
});

it("validates extension settings without rewriting corrupt files or activating cancelled operations", async () => {
  const manager = runtime([statisticsExtension()]); await manager.start();
  const signal = AbortSignal.abort(new Error("User cancelled"));
  expect((await manager.manage("disable", "fixture.statistics", signal)).success).toBe(false);
  expect(manager.host.snapshot().tools).toHaveLength(1);
  for (const invalid of [null, "fixture.statistics", [42], ["../bad"]]) {
    const body = JSON.stringify({ disabledExtensions: invalid });
    writeFileSync(join(root, "settings.json"), body);
    expect(() => loadSettings()).toThrow("invalid");
    expect(readFileSync(join(root, "settings.json"), "utf8")).toBe(body);
  }
});

it("routes config extension flags before opening Settings and rejects malformed or unbound requests", async () => {
  const manager = runtime([statisticsExtension()]);
  let calls = 0;
  const context = { openConfig() { throw new Error("Do not open Settings"); }, manageExtensions: (...args: Parameters<RuntimeExtensions["manage"]>) => { calls++; return manager.manage(...args); } };
  const result = await executeCommand(parseCommand("/config --extensions list")!, context);
  expect(result.success).toBe(true); expect(calls).toBe(1);
  for (const command of ["/config --extensions wrong", "/config --extensions disable", "/config --extensions list extra", "/config --extensions list --other", "/config --extensions enable fixture.statistics extra"]) {
    expect((await executeCommand(parseCommand(command)!, context)).success).toBe(false);
  }
  expect(calls).toBe(1);
  expect((await manager.manage("enable", "missing.id")).success).toBe(false);
});

it("exposes JSON one-shot list, persistent disable/enable and meaningful failure exit codes", async () => {
  const run = async (command: string) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../index.ts"), "--json", "-c", command], {
      cwd: root, env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe",
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(stderr).toBe(""); return { exit, body: JSON.parse(stdout) };
  };
  expect((await run("/config --extensions list")).body.data.extensions[0]).toMatchObject({ manifest: { id: "whyj.core", apiVersion: 1 }, enabled: true });
  expect((await run("/config --extensions disable whyj.core")).exit).toBe(0);
  expect(loadSettings().disabledExtensions).toEqual(["whyj.core"]);
  const disabledReload = await run("/config --extensions reload whyj.core");
  expect(disabledReload.exit).toBe(1); expect(disabledReload.body.error.message).toContain("Enable");
  expect((await run("/config --extensions enable whyj.core")).body.data.extensions[0].enabled).toBe(true);
  expect(loadSettings().disabledExtensions).toEqual([]);
}, 30_000);
