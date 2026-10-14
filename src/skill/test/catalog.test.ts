import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { CURATED_SKILL_REPOSITORIES } from "../catalog.ts";
import { skillHandler } from "../../cli/handlers/skill.ts";
import { skillPaths } from "../../runtime/skills/skill-store.ts";

it("requires the reviewed breadth import closure as well as fresh public CSV input", () => {
  const breadth = CURATED_SKILL_REPOSITORIES[1]!.skills.find(skill => skill.name === "market-breadth-analyzer")!;
  expect(Object.keys(breadth.reviewedFiles ?? {})).toHaveLength(15);
  expect(Object.hasOwn(breadth.reviewedFiles ?? {}, "scripts/market_breadth_analyzer.py")).toBe(true);
  expect(Object.hasOwn(breadth.reviewedFiles ?? {}, "scripts/scorer.py")).toBe(true);
  expect(breadth.modes[0]!.requires).toContain("reviewed-script-files");
  expect(breadth.modes[0]!.requires).toContain("network:tradermonty-breadth-csv");
});

it("pins the complete position-sizer calculation, report methodology and upstream tests", () => {
  const position = CURATED_SKILL_REPOSITORIES[1]!.skills.find(skill => skill.name === "position-sizer")!;
  expect(Object.keys(position.reviewedFiles ?? {})).toHaveLength(6);
  expect(Object.hasOwn(position.reviewedFiles ?? {}, "scripts/position_sizer.py")).toBe(true);
  expect(Object.hasOwn(position.reviewedFiles ?? {}, "scripts/tests/test_position_sizer.py")).toBe(true);
  for (const hash of Object.values(position.reviewedFiles ?? {})) expect(hash).toMatch(/^[a-f0-9]{64}$/);
  expect(position.modes[0]!.requires).toContain("reviewed-script-files");
  expect(position.modes[0]!.requires).toContain("private-output-authorization");
});

it("pins the complete market calendar helper and its upstream contract tests", () => {
  const environment = CURATED_SKILL_REPOSITORIES[1]!.skills.find(skill => skill.name === "market-environment-analysis")!;
  expect(Object.keys(environment.reviewedFiles ?? {})).toHaveLength(9);
  expect(Object.hasOwn(environment.reviewedFiles ?? {}, "scripts/_market_calendar.py")).toBe(true);
  expect(Object.hasOwn(environment.reviewedFiles ?? {}, "scripts/tests/test_market_calendar_contract.py")).toBe(true);
  for (const hash of Object.values(environment.reviewedFiles ?? {})) expect(hash).toMatch(/^[a-f0-9]{64}$/);
  expect(environment.modes[0]!.requires).not.toContain("reviewed-script-files");
  expect(environment.modes[1]!.requires).toContain("reviewed-script-files");
});

it("pins the complete technical confirmation script, guidance and upstream tests", () => {
  const technical = CURATED_SKILL_REPOSITORIES[1]!.skills.find(skill => skill.name === "technical-analyst")!;
  expect(Object.keys(technical.reviewedFiles ?? {})).toHaveLength(10);
  expect(Object.hasOwn(technical.reviewedFiles ?? {}, "references/contrarian-confirmation-checklist.md")).toBe(true);
  expect(Object.hasOwn(technical.reviewedFiles ?? {}, "scripts/tests/test_weekly_price_action.py")).toBe(true);
  for (const hash of Object.values(technical.reviewedFiles ?? {})) expect(hash).toMatch(/^[a-f0-9]{64}$/);
  expect(technical.modes[0]!.requires).not.toContain("reviewed-script-files");
  expect(technical.modes[1]!.requires).toContain("reviewed-script-files");
});

it("pins every workflow used by the five curated LLMQuant routers", () => {
  const llmquant = CURATED_SKILL_REPOSITORIES[0]!.skills;
  expect(llmquant.map(skill => skill.name)).toEqual([
    "llmquant-data", "llmquant-macro", "llmquant-equities", "llmquant-portfolio", "llmquant-risk",
  ]);
  expect(llmquant.map(skill => Object.keys(skill.reviewedFiles ?? {}).length)).toEqual([5, 4, 6, 6, 5]);
  expect(llmquant.reduce((total, skill) => total + Object.keys(skill.reviewedFiles ?? {}).length, 0)).toBe(26);
  expect(Object.hasOwn(llmquant[0]!.reviewedFiles ?? {}, "workflows/10k-risk-review.md")).toBe(true);
  expect(Object.hasOwn(llmquant[2]!.reviewedFiles ?? {}, "workflows/five-lens-stock-analysis.md")).toBe(true);
  expect(Object.hasOwn(llmquant[4]!.reviewedFiles ?? {}, "workflows/hedge-advisor.md")).toBe(true);
  for (const skill of llmquant) {
    expect(Object.hasOwn(skill.reviewedFiles ?? {}, "SKILL.md")).toBe(true);
    for (const hash of Object.values(skill.reviewedFiles ?? {})) expect(hash).toMatch(/^[a-f0-9]{64}$/);
    for (const mode of skill.modes) expect(mode.requires).toContain("reviewed-script-files");
  }
});

it("shows declared requirements for the actual curated path, without attributing them to a same-name project skill", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-skill-catalog-test-"));
  const cwd = process.cwd(), previousRoot = process.env.OHQUANT_DIR, previousSkills = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_DIR = join(root, "preferences");
  process.env.OHQUANT_SKILLS_DIR = join(root, "skills");
  process.chdir(root);
  const writeSkill = (path: string, name: string) => {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: Isolated fixture\n---\nFixture contents\n`);
  };
  try {
    mkdirSync(join(root, ".git"));
    const trading = join(root, "skills", "tradermonty-claude-trading-skills", "skills");
    writeSkill(join(trading, "position-sizer"), "position-sizer");
    writeSkill(join(trading, "llmquant-risk"), "llmquant-risk");
    expect(skillPaths()).not.toContain(join(trading, "llmquant-risk"));
    const llmquantRisk = join(root, "skills", "LLMQuant-skills", "skills", "llmquant-risk");
    writeSkill(llmquantRisk, "llmquant-risk");
    const uncheckedLlmquant = await skillHandler({}, ["info", "llmquant-risk"], {});
    expect(uncheckedLlmquant.message).toContain("reviewed-script-files: unverified");
    const checkedLlmquant = await skillHandler({ check: true }, ["info", "llmquant-risk"], {});
    expect(checkedLlmquant.message).toContain("reviewed-script-files: missing");
    expect(checkedLlmquant.message).toContain("workflows/fear-score.md: missing");
    const info = await skillHandler({}, ["info", "position-sizer"], {});
    expect(info.success).toBe(true);
    expect(info.message).toContain("declared, not verified");
    expect(info.message).toContain("python>=3.9");
    expect(info.message).toContain("installed revision not checked");
    expect(info.data).toMatchObject({ curated: { expectedRevision: CURATED_SKILL_REPOSITORIES[1]!.revision } });
    expect((await skillHandler({ "check-network": true }, ["info", "position-sizer"], {})).success).toBe(false);

    writeSkill(join(root, ".agents", "skills", "position-sizer"), "position-sizer");
    const shadowed = await skillHandler({}, ["info", "position-sizer"], {});
    expect(shadowed.success).toBe(true);
    expect(shadowed.message).not.toContain("Catalog pin");
    expect(shadowed.data).not.toHaveProperty("curated");
    expect((await skillHandler({ "check-network": true }, ["info", "position-sizer"], {})).success).toBe(false);
  } finally {
    process.chdir(cwd);
    if (previousRoot === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previousRoot;
    if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-skill-catalog-test-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
