import { expect, it } from "bun:test";
import { ExtensionHost, type ExtensionDefinition } from "../index.ts";
import { statisticsExtension } from "./fixtures/statistics-extension.ts";
import { builtinQuantExtension } from "../../runtime/builtin-extension.ts";

it("loads the builtin and an independent extension and exposes executable declarations", async () => {
  const host = new ExtensionHost({ cwd: "fixture", reserved: { tools: ["research_task"] } });
  try {
    await host.load(builtinQuantExtension); await host.load(statisticsExtension());
    expect(host.list().map(entry => entry.manifest.id)).toEqual(["whyj.core", "fixture.statistics"]);
    const snapshot = host.snapshot();
    expect(snapshot.skills[0]?.extensionId).toBe("fixture.statistics");
    expect(snapshot.capabilities[0]).toMatchObject({ requirement: "statistics-observations", status: "available", extensionId: "fixture.statistics" });
    const result = await snapshot.tools.find(tool => tool.name === "fixture_mean")!.execute("call", { values: [1, 2, 9] });
    expect(result.details).toMatchObject({ value: 4 });
    expect(await host.executeCommand("fixture-echo", ["research", "one"])).toEqual({ args: ["research", "one"], version: "1.0.0" });
    const capabilities = await host.executeCommand("quant-capabilities");
    expect(Array.isArray(capabilities)).toBe(true);
    expect(snapshot.tools.length).toBe(builtinQuantExtension.manifest.tools.length + 1);
  } finally { await host.dispose(); }
});

it("rejects incompatibility and conflicts before activation and preserves an enabled extension on failed reload", async () => {
  const host = new ExtensionHost({ cwd: "fixture" });
  let activated = 0, cleaned = 0;
  const definition = statisticsExtension();
  try {
    await expect(host.load({ ...definition, manifest: { ...definition.manifest, apiVersion: 2 }, activate() { activated++; throw new Error("must not run"); } })).rejects.toThrow("Unsupported extension API");
    expect(activated).toBe(0);
    await expect(host.load({ ...definition, manifest: { ...definition.manifest, version: "latest" } })).rejects.toThrow("Invalid extension release version");
    await expect(host.load({ ...definition, manifest: { ...definition.manifest, tools: ["duplicate", "duplicate"] } })).rejects.toThrow("Duplicate tools declarations");
    await expect(host.load({ ...definition, manifest: { ...definition.manifest, capabilities: ["web-search", "web-search"] } })).rejects.toThrow("Duplicate capabilities declarations");
    await host.load(definition);
    const before = host.snapshot();
    await expect(host.load({ ...definition, manifest: { ...definition.manifest, id: "fixture.conflict" }, activate() { activated++; throw new Error("must not run"); } })).rejects.toThrow("conflict");
    expect(activated).toBe(0);
    for (const kind of ["skills", "commands", "capabilities"] as const) {
      await expect(host.load({ manifest: { id: "fixture.conflict", version: "1.0.0", apiVersion: 1, tools: [], skills: [], commands: [], [kind]: [...(definition.manifest[kind] ?? [])] },
        activate() { activated++; throw new Error("must not run"); } })).rejects.toThrow(`${kind} conflict`);
    }
    expect(activated).toBe(0);
    await expect(host.reload({ ...definition, activate: () => ({ tools: [], skills: [], commands: [], dispose: () => { cleaned++; } }) })).rejects.toThrow("do not match");
    expect(cleaned).toBe(1); expect(host.snapshot().revision).toBe(before.revision);
    await expect(host.reload({ ...definition, activate: async context => ({ ...(await definition.activate(context)), capabilities: [] }) })).rejects.toThrow("Declared capabilities do not match");
    const invalidBinding = statisticsExtension({ version: "1.1.0", capabilities: [{ requirement: "statistics-observations", status: "available",
      reason: "Invalid fixture binding.", requiresTools: ["undeclared_tool"] }] });
    await expect(host.reload(invalidBinding)).rejects.toThrow("Invalid capability tool bindings");
    expect((await before.tools[0]!.execute("call", { values: [3, 5] })).details).toMatchObject({ value: 4 });
    await expect(host.reload({ ...definition, activate() { throw new Error("broken startup"); } })).rejects.toThrow("broken startup");
    expect(host.list()[0]!.enabled).toBe(true);
    expect(host.list()[0]!.diagnostics.join(" ")).toContain("broken startup");
  } finally { await host.dispose(); }
});

it("retires old references once, keeps cleanup failures visible and permits a clean re-enable", async () => {
  const host = new ExtensionHost({ cwd: "fixture" });
  let cleaned = 0;
  try {
    await host.load(statisticsExtension({ dispose() { cleaned++; throw new Error("fixture cleanup failed"); } }));
    const old = host.snapshot().tools[0]!;
    await host.disable("fixture.statistics"); await host.disable("fixture.statistics");
    expect(cleaned).toBe(1); expect(host.snapshot().tools).toEqual([]);
    await expect(old.execute("old", { values: [1] })).rejects.toThrow("no longer active");
    expect(host.list()[0]!.diagnostics.join(" ")).toContain("fixture cleanup failed");
    await host.reload(statisticsExtension({ version: "1.1.0", offset: 10 }));
    expect(cleaned).toBe(1);
    expect((await host.snapshot().tools[0]!.execute("new", { values: [1] })).details).toMatchObject({ value: 11, version: "1.1.0" });
    await host.disable("fixture.statistics"); await host.enable("fixture.statistics");
    expect(await host.executeCommand("fixture-echo")).toMatchObject({ version: "1.1.0" });
  } finally { await host.dispose(); }
  await expect(host.enable("fixture.statistics")).rejects.toThrow("disposed");
});

it("cancels running extension tools and waits for cooperative completion before disposing", async () => {
  const host = new ExtensionHost({ cwd: "fixture" });
  let entered!: () => void, release!: () => void, cleaned = false;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const finish = new Promise<void>(resolve => { release = resolve; });
  await host.load(statisticsExtension({ execute: async signal => {
    entered(); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    await finish;
  }, dispose() { cleaned = true; } }));
  const calling = host.snapshot().tools[0]!.execute("call", { values: [1] });
  const outcome = Promise.allSettled([calling]);
  await started;
  const disabling = host.disable("fixture.statistics");
  await Promise.resolve(); await Promise.resolve();
  expect(cleaned).toBe(false);
  release(); await disabling;
  expect((await outcome)[0]?.status).toBe("rejected"); expect(cleaned).toBe(true);
  await host.dispose();
});

it("bounds activation, cleans a late result and lets other extensions continue", async () => {
  const host = new ExtensionHost({ cwd: "fixture", activationTimeoutMs: 30 });
  let release!: (value: { tools: []; skills: []; commands: []; dispose(): void }) => void, cleaned!: () => void;
  const cleanup = new Promise<void>(resolve => { cleaned = resolve; });
  const delayed: ExtensionDefinition = { manifest: { id: "fixture.late", version: "1.0.0", apiVersion: 1, tools: [], skills: [], commands: [] },
    activate: () => new Promise(resolve => { release = resolve; }) };
  try {
    await expect(host.load(delayed)).rejects.toThrow("timed out");
    await host.load(statisticsExtension());
    release({ tools: [], skills: [], commands: [], dispose: cleaned }); await cleanup;
    expect(host.list().map(entry => entry.manifest.id)).toEqual(["fixture.statistics"]);
  } finally { await host.dispose(); }
});

it("snapshots manifest and implementation functions instead of using later caller mutations", async () => {
  const host = new ExtensionHost({ cwd: "fixture" });
  const definition = statisticsExtension(), original = await definition.activate({ apiVersion: 1, cwd: "fixture", signal: new AbortController().signal, report: () => {} });
  try {
    await host.load({ ...definition, activate: () => original });
    definition.manifest.version = "9.9.9";
    original.tools[0]!.execute = async () => { throw new Error("mutated implementation"); };
    original.commands[0]!.execute = async () => { throw new Error("mutated command"); };
    original.capabilities![0]!.reason = "mutated caller capability";
    const snapshot = host.snapshot(); snapshot.tools[0]!.name = "mutated snapshot"; snapshot.capabilities[0]!.reason = "mutated snapshot capability";
    expect(host.list()[0]!.manifest.version).toBe("1.0.0");
    expect((await host.snapshot().tools[0]!.execute("call", { values: [4] })).details).toMatchObject({ value: 4 });
    expect(await host.executeCommand("fixture-echo")).toMatchObject({ version: "1.0.0" });
    expect(host.snapshot().capabilities[0]!.reason).toBe("fixture_mean accepts explicit numeric observations.");
  } finally { await host.dispose(); }
});

it("cancels initialization on host shutdown and never publishes its late resources", async () => {
  const host = new ExtensionHost({ cwd: "fixture" });
  let entered!: () => void, cleaned!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const cleanup = new Promise<void>(resolve => { cleaned = resolve; });
  const definition = statisticsExtension();
  const loading = host.load({ ...definition, activate: async context => {
    entered(); await new Promise<void>(resolve => context.signal.addEventListener("abort", () => resolve(), { once: true }));
    const resources = await definition.activate(context);
    return { ...resources, dispose: cleaned };
  } });
  const outcome = Promise.allSettled([loading]);
  await started; await host.dispose(); await cleanup;
  expect((await outcome)[0]?.status).toBe("rejected");
  expect(host.snapshot()).toMatchObject({ tools: [], skills: [], commands: [] });
  expect(host.getDiagnostics(definition.manifest.id).join(" ")).toContain("disposed");
});
