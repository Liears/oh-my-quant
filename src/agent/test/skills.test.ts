import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills, invalidateSkillDiscovery } from "../src/skills.ts";
import { NodeExecutionEnv } from "../src/session-runtime/node.ts";
import { formatSkillsForSystemPrompt } from "../src/session-runtime/index.ts";

let TEST_DIR = "";

function writeSkill(dir: string, name: string): void {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `---
name: ${name}
description: Use ${name} for test discovery.
---

# ${name}
`, "utf-8");
}

afterEach(() => {
  if (TEST_DIR) rmSync(TEST_DIR, { recursive: true, force: true });
  TEST_DIR = "";
});

describe("discoverSkills", () => {
  it("uses Pi ignore rules and explicit-only metadata while preserving project precedence", async () => {
    TEST_DIR = mkdtempSync(join(tmpdir(), "whyj-skills-"));
    mkdirSync(join(TEST_DIR, ".git"));
    const project = join(TEST_DIR, ".agents", "skills"), installed = join(TEST_DIR, "installed");
    writeSkill(project, "shared");
    writeSkill(installed, "shared");
    writeSkill(installed, "ignored");
    writeSkill(installed, "explicit-only");
    writeFileSync(join(installed, ".gitignore"), "ignored/\n");
    writeFileSync(join(installed, "explicit-only", "SKILL.md"),
      "---\nname: explicit-only\ndescription: Manual workflow\ndisable-model-invocation: true\n---\nMANUAL_BODY");
    const result = await discoverSkills({ cwd: TEST_DIR, env: new NodeExecutionEnv({ cwd: TEST_DIR }), extraPaths: [installed] });
    expect(result.skills.map(skill => skill.name).sort()).toEqual(["explicit-only", "shared"]);
    expect(result.skills.find(skill => skill.name === "shared")?.sourcePath).toBe(project);
    expect(result.skills.find(skill => skill.name === "explicit-only")).toMatchObject({ disableModelInvocation: true, content: "MANUAL_BODY" });
    const prompt = formatSkillsForSystemPrompt(result.skills);
    expect(prompt).toContain("<name>shared</name>");
    expect(prompt).not.toContain("<name>explicit-only</name>");
    expect(prompt).not.toContain("MANUAL_BODY");
  });
  it("reloads updated content at the same path after installation invalidates discovery", async () => {
    TEST_DIR = mkdtempSync(join(tmpdir(), "whyj-skills-"));
    mkdirSync(join(TEST_DIR, ".git"));
    const installed = join(TEST_DIR, "installed");
    writeSkill(installed, "revision-test");
    const options = { cwd: TEST_DIR, env: new NodeExecutionEnv({ cwd: TEST_DIR }), extraPaths: [installed] };
    const before = await discoverSkills(options);
    writeFileSync(join(installed, "revision-test", "SKILL.md"), "---\nname: revision-test\ndescription: Updated research instructions\n---\nUPDATED_CONTENT");
    expect((await discoverSkills(options)).skills[0]!.content).toBe(before.skills[0]!.content);
    invalidateSkillDiscovery();
    const after = await discoverSkills(options);
    expect(after.skills[0]!.content).toContain("UPDATED_CONTENT");
    expect(after.skills[0]!.description).toBe("Updated research instructions");
  });
  it("defaults to project and explicit skill paths without user-level Codex or Claude sources", async () => {
    TEST_DIR = mkdtempSync(join(tmpdir(), "whyj-skills-"));
    const cwd = join(TEST_DIR, "repo");
    const projectSkills = join(cwd, ".agents", "skills");
    const installedSkills = join(TEST_DIR, "installed-skills");
    mkdirSync(join(cwd, ".git"), { recursive: true });
    writeSkill(projectSkills, "project-agent-skill");
    writeSkill(installedSkills, "installed-quant-skill");

    const result = await discoverSkills({
      cwd,
      env: new NodeExecutionEnv({ cwd }),
      extraPaths: [installedSkills],
    });

    expect(result.skills.map((skill) => skill.name).sort()).toEqual([
      "installed-quant-skill",
      "project-agent-skill",
    ]);
    expect(result.sources.every((source) => source.scope === "project")).toBe(true);
    expect(result.sources.some((source) => source.source === "codex" || source.source === "claude")).toBe(false);
  });
});
