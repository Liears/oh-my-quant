import { expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import type { QuantSkill } from "../../agent/src/skills.ts";
import { formatSkillsForSystemPrompt } from "../../agent/src/session-runtime/index.ts";
import { prepareRuntimeSkills, scopeRuntimeSkills } from "../skills/skill-readiness.ts";

it("projects pinned risk evidence and unit limits into actual model metadata and preserves them under task scoping", () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-method-skill-")), previous = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_SKILLS_DIR = root;
  const skill: QuantSkill = { name: "llmquant-risk", description: "Synthetic risk fixture", content: "Fixture", source: "pi", scope: "project",
    filePath: join(root, "LLMQuant-skills", "skills", "llmquant-risk", "SKILL.md"), sourcePath: root };
  try {
    const prepared = prepareRuntimeSkills([skill], [{ name: "bash" }], root, { readReviewedFiles: () => ({
      requirement: "reviewed-script-files", status: "available", reason: "Synthetic reviewed fixture." }) });
    expect(prepared[0]!.readiness?.modes.map(mode => mode.status)).toEqual(["blocked", "needs-input"]);
    for (const projected of [prepared, scopeRuntimeSkills([skill], prepared, ["bash"])]) {
      const index = formatSkillsForSystemPrompt(projected);
      expect(index).toContain("price scenario cannot determine a collar cap");
      expect(index).toContain("actual multiplier");
      expect(index).toContain("contract count");
      expect(index).toContain("continuous coverage through that horizon");
      expect(index).toContain("limited supplied evidence");
    }
    const shadow = { ...skill, filePath: join(root, ".agents", "skills", "llmquant-risk", "SKILL.md") };
    expect(formatSkillsForSystemPrompt(prepareRuntimeSkills([shadow], [{ name: "bash" }], root)))
      .not.toContain("actual multiplier");
  } finally {
    if (previous === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previous;
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-method-skill-") || within.includes(sep)) throw new Error("Unexpected skill fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});
