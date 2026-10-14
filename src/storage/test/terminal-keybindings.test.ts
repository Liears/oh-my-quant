import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, saveSettings } from "../index.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";

it("retains configured interruption and failed-quote retry bindings", () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-terminal-bindings-"));
  const previous = process.env.OHQUANT_DIR;
  process.env.OHQUANT_DIR = root;
  try {
    saveSettings({ ...DEFAULT_SETTINGS, keybindings: { interruptResearch: ["Ctrl+X"], retryFailedQuotes: ["ctrl+r"] } });
    expect(loadSettings().keybindings).toEqual({ interruptResearch: ["ctrl+x"], retryFailedQuotes: ["ctrl+r"] });
    const settings = loadSettings();
    expect(() => saveSettings({ ...settings, keybindings: { interruptResearch: ["ctrl+ctrl+g"] } })).toThrow();
    for (const chord of ["escape", "ctrl+c", "ctrl+d", "ctrl+p", "ctrl+i", "meta+g"]) {
      expect(() => saveSettings({ ...settings, keybindings: { interruptResearch: [chord] } })).toThrow();
    }
    expect(loadSettings().keybindings).toEqual({ interruptResearch: ["ctrl+x"], retryFailedQuotes: ["ctrl+r"] });
    expect(() => saveSettings({ ...settings, keybindings: { interruptResearch: ["ctrl+r"] } })).toThrow();
    saveSettings({ ...settings, keybindings: { interruptResearch: [], retryFailedQuotes: [] } });
    expect(loadSettings().keybindings).toEqual({ interruptResearch: [], retryFailedQuotes: [] });
  } finally {
    if (previous === undefined) delete process.env.OHQUANT_DIR;
    else process.env.OHQUANT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
