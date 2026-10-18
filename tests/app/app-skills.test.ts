import { AppRuntime } from "../../src/app-runtime.ts";
import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

it("refreshes skill suggestions after an explicit reload without launching a model", async () => {
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
    await runtime.submit("/skill reload");
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
