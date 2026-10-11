import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { ensureDefaultSkills, skillPaths, type SkillInstallProgress } from "./store.ts";
import { CURATED_SKILL_REPOSITORIES } from "./catalog.ts";
import { createDefaultSessionDependencies } from "../agent/src/session-dependencies.ts";

async function fixture(run: (root: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "whyj-default-skills-"));
  try { await run(root); } finally {
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-default-skills-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
}

it("keeps existing directories offline without claiming discovery or dependency readiness", () => fixture(async root => {
  for (const repo of ["LLMQuant-skills", "tradermonty-claude-trading-skills"]) mkdirSync(join(root, repo));
  const events: SkillInstallProgress[] = [];
  await ensureDefaultSkills({ root, git: () => { throw new Error("No Git expected"); }, onProgress: event => events.push(event) });
  expect(events.map(event => event.status)).toEqual(["present", "present"]);
  expect(events.every(event => event.message.includes("checked separately"))).toBe(true);
}));

it("reports failure and retry, then continues to the other default repository", () => fixture(async root => {
  const events: SkillInstallProgress[] = [];
  await ensureDefaultSkills({ root, git: args => {
    if (args.includes("https://github.com/LLMQuant/skills.git")) throw new Error("fixture offline");
    const repository = CURATED_SKILL_REPOSITORIES[1]!;
    if (args.includes("checkout")) {
      for (const skill of repository.skills) {
        const path = join(args[1]!, "skills", skill.name);
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, "SKILL.md"), "fixture");
      }
    }
    return repository.revision;
  }, onProgress: event => events.push(event) });
  expect(events.map(event => event.status)).toEqual(["installing", "failed", "installing", "installed"]);
  expect(events[1]?.message).toContain("retry /skill install LLMQuant/skills");
  expect(readdirSync(root)).toEqual(["tradermonty-claude-trading-skills"]);
}));

it("does not launch the second install after cancellation", () => fixture(async root => {
  const abort = new AbortController(), events: SkillInstallProgress[] = [];
  let calls = 0;
  await ensureDefaultSkills({ root, signal: abort.signal, git: () => { calls++; abort.abort(); return ""; }, onProgress: event => events.push(event) });
  expect(calls).toBe(1);
  expect(events.map(event => event.status)).toEqual(["installing", "cancelled"]);
  expect(readdirSync(root)).toEqual([]);
}));

it("publishes installed paths and refresh revisions to an already composed default session loader", () => fixture(async root => {
  const previous = process.env.OHQUANT_DIR, previousSkills = process.env.OHQUANT_SKILLS_DIR;
  const installed = join(root, "installed");
  process.env.OHQUANT_DIR = root; process.env.OHQUANT_SKILLS_DIR = installed;
  mkdirSync(join(root, ".git"));
  mkdirSync(join(installed, "tradermonty-claude-trading-skills"), { recursive: true });
  try {
    const local = createDefaultSessionDependencies({ cwd: root, skillPaths, settings: { skillIntegrations: { external: false } } });
    const before = local.readSkillRevision!();
    expect(await local.loadSkills()).toEqual([]);
    await ensureDefaultSkills({ root: installed, git: () => { throw new Error("offline"); } });
    expect(local.readSkillRevision!()).toBe(before);
    const repository = CURATED_SKILL_REPOSITORIES[0]!;
    await ensureDefaultSkills({ root: installed, git: args => {
      if (args.includes("checkout")) for (const skill of repository.skills) {
        const path = join(args[1]!, "skills", skill.name);
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, "SKILL.md"), `---\nname: ${skill.name}\ndescription: Fixture research skill\n---\nFixture instructions`);
      }
      return repository.revision;
    } });
    expect(local.readSkillRevision!()).not.toBe(before);
    expect((await local.loadSkills()).map(skill => skill.name).sort()).toEqual(repository.skills.map(skill => skill.name).sort());
  } finally {
    if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
    if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
  }
}));
