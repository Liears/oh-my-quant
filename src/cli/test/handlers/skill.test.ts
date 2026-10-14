import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { skillHandler } from "../../handlers/skill.ts";
import { installSkills, skillPaths } from "../../../runtime/skills/skill-store.ts";
import { resolveSkillsDir } from "../../../storage/index.ts";

describe("skillHandler", () => {
  it("rejects valued import flags and unrelated skill sources before running Python", async () => {
    const fixture = { name: "technical-analyst", filePath: join(resolveSkillsDir(), "tradermonty-claude-trading-skills", "skills", "technical-analyst", "SKILL.md"),
      description: "Fixture", scope: "user", source: "pi" };
    const ctx = { agentSession: { getSkills: async () => [fixture] } as never };
    const invalid = await skillHandler({ "check-imports": "false" }, ["info", fixture.name], ctx);
    expect(invalid.success).toBe(false); expect(invalid.message).toContain("takes no value");
    fixture.filePath = join(resolveSkillsDir(), "shadow", "SKILL.md");
    const shadow = await skillHandler({ "check-imports": true }, ["info", fixture.name], ctx);
    expect(shadow.success).toBe(false); expect(shadow.message).toContain("curated skills");
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
    expect(result.message).toContain("/skill info <name>");
  });

  it("shows error for info on unknown skill", async () => {
    const result = await skillHandler({}, ["info", "nonexistent-skill-xyz"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown skill");
  });

  it("shows error for run without agent session", async () => {
    const result = await skillHandler({}, ["run", "some-skill"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("active agent session");
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

  it("shows usage for install without repo", async () => {
    const result = await skillHandler({}, ["install"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("/skill install");
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
