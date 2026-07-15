import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, normalizeModelSelection, normalizeSkillIntegrations, normalizeThinkingLevel } from "../src/settings.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";

describe("settings model normalization", () => {
  it("preserves direct model ids when no alias mappings are configured", () => {
    expect(normalizeModelSelection("openai/gpt-5.5", {})).toBe("openai/gpt-5.5");
  });

  it("accepts an alias or exact model id from a configured mapping", () => {
    const env = {
      WHYJ_DEFAULT_SONNET_MODEL: "glm-5.2",
      WHYJ_DEFAULT_OPUS_MODEL: "glm-5.2",
      WHYJ_DEFAULT_HAIKU_MODEL: "glm-5.1",
    };
    expect(normalizeModelSelection("sonnet", env)).toBe("sonnet");
    expect(normalizeModelSelection("glm-5.2", env)).toBe("glm-5.2");
    expect(normalizeModelSelection("glm-5.1", env)).toBe("glm-5.1");
  });

  it("forces a mismatched model to the first configured alias", () => {
    expect(normalizeModelSelection("glm-5.2[1m]", {
      WHYJ_DEFAULT_SONNET_MODEL: "glm-5.2",
      WHYJ_DEFAULT_OPUS_MODEL: "glm-5.2",
    })).toBe("sonnet");
  });

  it("uses the first available alias when sonnet is not configured", () => {
    expect(normalizeModelSelection("unknown-model", {
      WHYJ_DEFAULT_OPUS_MODEL: "claude-opus-4-6",
    })).toBe("opus");
  });
});

describe("settings semantic normalization", () => {
  it("keeps every supported thinking level, including off", () => {
    expect(normalizeThinkingLevel("off")).toBe("off");
    expect(normalizeThinkingLevel("xhigh")).toBe("xhigh");
    expect(normalizeThinkingLevel("invalid")).toBe("high");
  });

  it("migrates legacy Codex and Claude switches into one external-skills switch", () => {
    expect(normalizeSkillIntegrations({ codex: true, claude: false })).toEqual({ external: true });
    expect(normalizeSkillIntegrations({ codex: false, claude: false })).toEqual({ external: false });
    expect(normalizeSkillIntegrations({ external: false, codex: true })).toEqual({ external: false });
  });

  it("rewrites a v1 settings file into the normalized v3 schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "whyj-settings-v1-"));
    const previous = process.env.OHQUANT_DIR;
    process.env.OHQUANT_DIR = dir;
    try {
      writeFileSync(join(dir, "settings.json"), JSON.stringify({
        ...DEFAULT_SETTINGS,
        version: 1,
        insightEnabled: true,
        thinkingLevel: "off",
        skillIntegrations: { codex: true, claude: false },
      }), "utf-8");

      const settings = loadSettings();
      const saved = JSON.parse(readFileSync(join(dir, "settings.json"), "utf-8"));
      expect(settings.version).toBe(3);
      expect(settings.thinkingLevel).toBe("off");
      expect(settings.skillIntegrations).toEqual({ external: true });
      expect(saved.skillIntegrations).toEqual({ external: true });
      expect(saved.insightEnabled).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.OHQUANT_DIR;
      else process.env.OHQUANT_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates the v2 artifact mode into the v3 auto switch", () => {
    const dir = mkdtempSync(join(tmpdir(), "whyj-settings-v2-"));
    const previous = process.env.OHQUANT_DIR;
    process.env.OHQUANT_DIR = dir;
    try {
      writeFileSync(join(dir, "settings.json"), JSON.stringify({
        ...DEFAULT_SETTINGS,
        version: 2,
        artifactGeneration: { mode: "auto" },
      }), "utf-8");

      const settings = loadSettings();
      const saved = JSON.parse(readFileSync(join(dir, "settings.json"), "utf-8"));
      expect(settings.version).toBe(3);
      expect(settings.artifactGeneration).toEqual({ auto: true });
      expect(saved.artifactGeneration).toEqual({ auto: true });
    } finally {
      if (previous === undefined) delete process.env.OHQUANT_DIR;
      else process.env.OHQUANT_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
