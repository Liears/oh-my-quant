import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { lockSync } from "proper-lockfile";
import { loadSettings, saveSettings } from "../src/settings.ts";
import { loadPanelPortfolio, savePanelPortfolio } from "../src/panel-portfolio.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { editPortfolio } from "../../runtime/research/portfolio.ts";

let root: string;
let previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "ohq-preferences-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR;
  else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected preferences test directory");
  rmSync(root, { recursive: true, force: true });
});

describe("durable preferences", () => {
  it("rejects stale settings drafts, including cloned drafts and unversioned replacements", () => {
    const first = loadSettings();
    const second = structuredClone(first);
    first.model = "first-model";
    saveSettings(first);
    second.model = "second-model";
    expect(() => saveSettings(second)).toThrow("changed");
    expect(() => saveSettings(structuredClone(DEFAULT_SETTINGS))).toThrow("changed");
    expect(loadSettings().model).toBe("first-model");
    expect(second.model).toBe("second-model");
    first.showPortfolioPanel = false;
    saveSettings(first);
    expect(loadSettings().showPortfolioPanel).toBe(false);
    expect(JSON.parse(readFileSync(join(root, "settings.json"), "utf8")).revision).toBeUndefined();
  });

  it("detects external edits and does not replace corrupted settings with defaults", () => {
    const draft = loadSettings();
    const path = join(root, "settings.json");
    writeFileSync(path, JSON.stringify({ ...DEFAULT_SETTINGS, model: "external-editor" }));
    expect(() => saveSettings(draft)).toThrow("changed");
    for (const broken of ['{"env":{"KEY":"private-test-secret"}', "null", "[]", '{"provider":42}', '{"env":42}', '{"env":{"KEY":42}}', '{"providers":{"custom":[]}}']) {
      writeFileSync(path, broken);
      expect(() => loadSettings()).toThrow("settings.json is invalid");
      expect(() => saveSettings(draft)).toThrow("settings.json is invalid");
      try { loadSettings(); } catch (error) { expect(String(error)).not.toContain("private-test-secret"); }
      expect(readFileSync(path, "utf8")).toBe(broken);
    }
  });

  it("does not migrate or save while another writer holds the file", () => {
    const path = join(root, "settings.json");
    const legacy = JSON.stringify({ ...DEFAULT_SETTINGS, version: 1 });
    writeFileSync(path, legacy);
    const release = lockSync(path, { realpath: false, stale: 10_000, update: 2_000 });
    try {
      expect(() => loadSettings()).toThrow("being updated");
      expect(readFileSync(path, "utf8")).toBe(legacy);
    } finally { release(); }
    const migrated = loadSettings();
    expect(migrated.version).toBe(3);
    saveSettings(migrated);
  });

  it.each(["doctor", "help"] as const)("preserves corrupt settings and returns safe CLI %s output", (command) => {
    const path = join(root, "settings.json");
    const broken = '{"env":{"KEY":"private-cli-secret"}';
    writeFileSync(path, broken);
    const args = command === "help" ? ["--json", "--help"] : ["--json", "doctor"];
    const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "../../index.ts"), ...args], {
      env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe", timeout: 10_000,
    });
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    expect(stdout + stderr).not.toContain("private-cli-secret");
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(command === "help" ? 0 : 1);
    const body = JSON.parse(stdout);
    expect(body.ok).toBe(args.includes("--help"));
    if (!body.ok) expect(body.error).toMatchObject({ code: "settings_unavailable", message: expect.stringContaining("Repair or restore") });
    expect(readFileSync(path, "utf8")).toBe(broken);
  }, 15_000);

  it("rejects a stale whole-portfolio save while command edits preserve other groups", () => {
    editPortfolio({ type: "create", name: "Original" });
    const draft = loadPanelPortfolio();
    editPortfolio({ type: "create", name: "Other terminal" });
    draft.groups[0]!.name = "Stale rename";
    expect(() => savePanelPortfolio(draft)).toThrow("changed");
    editPortfolio({ type: "rename", group: "Original", name: "Renamed" });
    expect(loadPanelPortfolio().groups.map(group => group.name)).toEqual(["Renamed", "Other terminal"]);
    expect(JSON.parse(readFileSync(join(root, "panel-portfolio.json"), "utf8")).revision).toBeUndefined();
  });

  it("retains invalid portfolio files and never treats them as an empty editable portfolio", () => {
    const draft = loadPanelPortfolio();
    const path = join(root, "panel-portfolio.json");
    for (const broken of ['{"symbols":', "null", "[]", '{"symbols":{},"groups":[]}']) {
      writeFileSync(path, broken);
      expect(() => loadPanelPortfolio()).toThrow("invalid");
      expect(() => savePanelPortfolio(draft)).toThrow("invalid");
      expect(() => editPortfolio({ type: "create", name: "Must not overwrite" })).toThrow("invalid");
      expect(readFileSync(path, "utf8")).toBe(broken);
    }
  });

  it("preserves every portfolio edit across eight independent processes", async () => {
    const children = Array.from({ length: 8 }, (_, index) => Bun.spawn([
      process.execPath, join(import.meta.dir, "fixtures", "preferences-writer.ts"), String(index),
    ], { env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe" }));
    try {
      const results = await Promise.all(children.map(async child => ({
        exit: await child.exited, error: await new Response(child.stderr).text(),
      })));
      expect(results).toEqual(Array.from({ length: 8 }, () => ({ exit: 0, error: "" })));
      const groups = loadPanelPortfolio().groups;
      expect(groups.map(group => group.name).sort()).toEqual(Array.from({ length: 8 }, (_, i) => `Process ${i}`));
      expect(new Set(groups.map(group => group.id)).size).toBe(8);
    } finally {
      for (const child of children) if (child.exitCode === null) child.kill();
      await Promise.all(children.map(child => child.exited));
    }
  }, 15_000);

  it("permits only one writer among eight processes holding the same settings draft version", async () => {
    const base = loadSettings();
    const children = Array.from({ length: 8 }, (_, index) => Bun.spawn([
      process.execPath, join(import.meta.dir, "fixtures", "preferences-writer.ts"), String(index), "settings", base.revision!,
    ], { env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe" }));
    try {
      const results = await Promise.all(children.map(async child => ({
        exit: await child.exited, output: (await new Response(child.stdout).text()).trim(), error: await new Response(child.stderr).text(),
      })));
      expect(results.map(result => result.exit)).toEqual(Array(8).fill(0));
      expect(results.map(result => result.error)).toEqual(Array(8).fill(""));
      expect(results.filter(result => result.output === "saved")).toHaveLength(1);
      expect(results.filter(result => result.output === "conflict")).toHaveLength(7);
      expect(loadSettings().model).toMatch(/^Process [0-7]$/);
    } finally {
      for (const child of children) if (child.exitCode === null) child.kill();
      await Promise.all(children.map(child => child.exited));
    }
  }, 15_000);
});
