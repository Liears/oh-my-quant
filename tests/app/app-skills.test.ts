import { expect, it } from "bun:test";
import { AppRuntime, createInitialAppState } from "../../src/app-runtime.ts";
import type { UIMessage } from "../../src/types/ui.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { QuantTui } from "../../src/tui/src/tui.ts";
import { readSkillPython } from "../../src/skill/python-probe.ts";

it("refreshes skill suggestions after an explicit check without launching a model", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-skill-check-ui-"));
  const cwd = process.cwd(), previous = process.env.OHQUANT_DIR, previousSkills = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_DIR = join(root, "preferences"); process.env.OHQUANT_SKILLS_DIR = join(root, "installed");
  process.chdir(root);
  const path = join(root, ".agents", "skills", "fixture-research");
  mkdirSync(join(root, ".git")); mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), "---\nname: fixture-research\ndescription: Local fixture\n---\nFixture");
  let refreshed = 0;
  const runtime = new AppRuntime({ onMessages: () => {}, onActivity: () => {}, onSkillsChanged: () => { refreshed++; } });
  try {
    await runtime.submit("/skill info fixture-research");
    expect(refreshed).toBe(0);
    await runtime.submit("/skill info fixture-research --check");
    expect(refreshed).toBe(1);
    await runtime.submit("/skill info nonexistent --check");
    expect(refreshed).toBe(1);
  } finally {
    await runtime.shutdown(); process.chdir(cwd);
    if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
    if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-skill-check-ui-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

it("notifies the composer only when a background repository was installed", async () => {
  let refreshed = 0;
  const runtime = new AppRuntime({ onMessages: () => {}, onActivity: () => {}, onSkillsChanged: () => { refreshed++; } });
  try {
    await runtime.startSkillInstallation(async options => {
      for (const status of ["present", "installing", "failed", "installed", "cancelled"] as const) {
        options?.onProgress?.({ repo: "fixture/repo", status, message: status });
      }
    });
    expect(refreshed).toBe(1);
  } finally { await runtime.shutdown(); }
});

it("refreshes real TUI readiness labels after explicit imports, including a completed check with missing dependencies", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-skill-import-ui-"));
  const cwd = process.cwd(), previous = process.env.OHQUANT_DIR, previousSkills = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_DIR = join(root, "preferences"); process.env.OHQUANT_SKILLS_DIR = join(root, "installed");
  process.chdir(root);
  mkdirSync(join(root, ".git"));
  const path = join(process.env.OHQUANT_SKILLS_DIR, "tradermonty-claude-trading-skills", "skills", "market-environment-analysis");
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), "---\nname: market-environment-analysis\ndescription: Import UI fixture\n---\nSynthetic instructions.");
  const tui = new QuantTui(createInitialAppState("fixture"));
  const input = tui as unknown as { inputBuf: string; currentSuggestions(): Array<{ fill: string; label: string }> };
  input.inputBuf = "/skill:market-environment";
  let refreshed = 0, refresh = Promise.resolve();
  const runtime = new AppRuntime({ onMessages: () => {}, onActivity: () => {}, onSkillsChanged: () => {
    refreshed++; refresh = tui.refreshSkills(() => runtime.getSkillSuggestions());
  } });
  try {
    await tui.refreshSkills(() => runtime.getSkillSuggestions());
    expect(input.currentSuggestions()[0]!.label).toContain("unverified");
    await runtime.submit("/skill info market-environment-analysis --check-imports"); await refresh;
    expect(readSkillPython(root)).toBeDefined();
    // The fixture deliberately lacks the reviewed script closure. A completed check
    // must refresh its blocked label, rather than imply that imports enable a workflow.
    expect((await runtime.getSkillSuggestions())[0]!.description).toContain("blocked");
    expect(refreshed).toBe(1); expect(input.currentSuggestions()[0]!.label).toContain("blocked");
    await runtime.submit("/skill info market-environment-analysis --check-imports false");
    await runtime.submit("/skill info nonexistent --check-imports");
    expect(refreshed).toBe(1); expect(input.currentSuggestions()[0]!.label).toContain("blocked");
  } finally {
    await runtime.shutdown(); process.chdir(cwd);
    if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
    if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-skill-import-ui-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);

it("keeps help usable while background skills install, then displays failure and retry", async () => {
  let messages: UIMessage[] = [], helped = false, calls = 0;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const runtime = new AppRuntime({ onMessages: value => { messages = value; }, onActivity: () => {}, onHelpRequest: () => { helped = true; } });
  const install = runtime.startSkillInstallation(async options => {
    calls++;
    options?.onProgress?.({ repo: "fixture/repo", status: "installing", message: "Installing fixture" });
    await pending;
    options?.onProgress?.({ repo: "fixture/repo", status: "failed", message: "Offline. Retry /skill install fixture/repo" });
  });
  try {
    expect(runtime.startSkillInstallation()).toBe(install);
    expect(calls).toBe(1);
    await runtime.submit("/help");
    expect(helped).toBe(true);
    expect(messages.some(message => message.role === "assistant" && message.text?.includes("Installing fixture"))).toBe(true);
    finish(); await install;
    expect(messages.some(message => message.role === "error" && message.text?.includes("Retry /skill install"))).toBe(true);
  } finally { finish(); await runtime.shutdown(); }
});

it("cancels startup installation on shutdown, waits for cleanup and rejects late UI events", async () => {
  let notifications = 0, cancelled = false, cleaned = false;
  const runtime = new AppRuntime({ onMessages: () => { notifications++; }, onActivity: () => {} });
  void runtime.startSkillInstallation(async options => {
    await new Promise<void>(resolve => options?.signal?.addEventListener("abort", () => { cancelled = true; resolve(); }, { once: true }));
    await Promise.resolve();
    cleaned = true;
    options?.onProgress?.({ repo: "fixture/repo", status: "failed", message: "late event" });
  });
  await runtime.shutdown();
  expect(cancelled).toBe(true);
  expect(cleaned).toBe(true);
  expect(notifications).toBe(0);
});
