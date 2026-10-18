import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillHandler } from "../../handlers/skill.ts";
import { installSkills, skillPaths } from "../../../runtime/skills/skill-store.ts";
import { resolveSkillsDir } from "../../../storage/index.ts";
import { commandPreflight } from "../../../runtime/workspace/command-preflight.ts";
import { parseCommand } from "../../registry.ts";

describe("skillHandler", () => {
  it("accepts preset install and reload but rejects retired probes before execution", () => {
    for (const command of ["/skill install", "/skill reload"]) expect(commandPreflight(parseCommand(command)!)).toBeUndefined();
    for (const command of ["/skill info x --check", "/skill info x --check-imports", "/skill info x --check-network", "/skill audit x"]) {
      expect(commandPreflight(parseCommand(command)!)?.success).toBe(false);
    }
  });

  it("loads existing presets without network or credentials and reloads edited content", async () => {
    const root = mkdtempSync(join(tmpdir(), "whyj-skill-command-")), previous = process.env.OHQUANT_SKILLS_DIR;
    process.env.OHQUANT_SKILLS_DIR = root;
    try {
      const skillDir = join(root, "LLMQuant-skills", "skills", "llmquant-data");
      mkdirSync(skillDir, { recursive: true });
      mkdirSync(join(root, "tradermonty-claude-trading-skills"));
      const file = join(skillDir, "SKILL.md");
      writeFileSync(file, "---\nname: llmquant-data\ndescription: Preset fixture\n---\nFIRST");
      const result = await skillHandler({}, ["install", "llmquant-data"], {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Selected llmquant-data");
      const before = await skillHandler({}, ["info", "llmquant-data"], {});
      expect(before.data).toMatchObject({ content: "FIRST" });
      expect(before.data).not.toHaveProperty("readiness");
      writeFileSync(file, "---\nname: llmquant-data\ndescription: Updated preset fixture\n---\nSECOND");
      await skillHandler({}, ["reload"], {});
      expect((await skillHandler({}, ["info", "llmquant-data"], {})).data).toMatchObject({ content: "SECOND" });
    } finally {
      if (previous === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previous;
      if (!root.startsWith(join(tmpdir(), "whyj-skill-command-"))) throw new Error("Unsafe cleanup");
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("lists skills (or reports none found)", async () => {
    const result = await skillHandler({}, [], {});
    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
    expect(
      result.message!.includes("Skills") || result.message!.includes("No skills found"),
    ).toBe(true);
  });

  it("shows error for missing name on info", async () => {
    const result = await skillHandler({}, ["info"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("/skill info NAME");
  });

  it("shows error for info on unknown skill", async () => {
    const result = await skillHandler({}, ["info", "nonexistent-skill-xyz"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown skill");
  });

  it("shows error for run without agent session", async () => {
    const result = await skillHandler({}, ["run", "some-skill"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown skill");
  });

  it("rejects run with missing skill name", async () => {
    const result = await skillHandler({}, ["run"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("/skill");
  });

  it("rejects direct /skill:name invocation for unknown skill", async () => {
    const result = await skillHandler({}, ["nonexistent-skill-xyz"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown skill");
  });

  it("rejects invalid install repo format before invoking git", async () => {
    const result = await installSkills("not-a-github-repo");
    expect(result.success).toBe(false);
    expect(result.message).toContain("owner/repo");
  });

  it("discovers installed repo skills from nested skills directories", () => {
    const repoDir = join(resolveSkillsDir(), "__skillpaths-test-repo__");
    mkdirSync(join(repoDir, "skills"), { recursive: true });
    mkdirSync(join(repoDir, "examples", "skills"), { recursive: true });
    try {
      const paths = skillPaths();
      expect(paths).toContain(join(repoDir, "skills"));
      expect(paths).not.toContain(repoDir);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
