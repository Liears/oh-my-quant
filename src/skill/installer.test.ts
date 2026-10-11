import { expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { installSkillRepository, type SkillGit } from "./installer.ts";
import { skillPaths } from "./store.ts";

async function fixture(run: (f: { root: string; upstream: string; target: string; git: SkillGit; transport: SkillGit; install: () => ReturnType<typeof installSkillRepository> }) => void | Promise<void>) {
  const base = mkdtempSync(join(tmpdir(), "whyj-skill-install-"));
  const root = join(base, "skills"), upstream = join(base, "upstream"), target = join(root, "owner-repo");
  const config = join(base, "gitconfig");
  writeFileSync(config, "");
  const git: SkillGit = (args, timeout) => execFileSync("git", args, { encoding: "utf8", timeout, stdio: "pipe",
    env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" } }).trim();
  const transport: SkillGit = (args, timeout) => {
    if (args[0] === "clone") {
      const local = [...args]; local[local.length - 2] = upstream;
      const output = git(local, timeout);
      git(["-C", local.at(-1)!, "remote", "set-url", "origin", "https://github.com/owner/repo.git"], timeout);
      return output;
    }
    if (args.includes("pull")) return git(["-c", `url.${upstream.replace(/\\/g, "/")}.insteadOf=https://github.com/owner/repo.git`, ...args], timeout);
    if (args.includes("fetch")) {
      const local = [...args]; local[local.indexOf("origin")] = upstream;
      return git(local, timeout);
    }
    return git(args, timeout);
  };
  try {
    mkdirSync(upstream);
    git(["init", "--initial-branch=main", upstream], 10_000);
    writeFileSync(join(upstream, "SKILL.md"), "original\n");
    git(["-C", upstream, "add", "."], 10_000);
    git(["-C", upstream, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "initial"], 10_000);
    await run({ root, upstream, target, git, transport, install: () => installSkillRepository(root, "owner/repo", transport) });
  } finally {
    const within = relative(realpathSync(tmpdir()), realpathSync(base));
    if (!within.startsWith("whyj-skill-install-") || within.includes(sep)) throw new Error("Unsafe fixture cleanup");
    rmSync(base, { recursive: true, force: true });
  }
}

it("publishes a complete clone and reports its exact source and revision", () => fixture(async f => {
  const result = await f.install();
  expect(result.success).toBe(true);
  expect(result.source).toBe("https://github.com/owner/repo.git");
  expect(result.revision).toBe(await f.git(["-C", f.upstream, "rev-parse", "HEAD"], 10_000));
  expect(readFileSync(join(f.target, "SKILL.md"), "utf8").trim()).toBe("original");
  expect(readdirSync(f.root)).toEqual(["owner-repo"]);
}));

it.each(["tracked", "untracked", "ignored"])("preserves %s changes without attempting network update", kind => fixture(async f => {
  expect((await f.install()).success).toBe(true);
  const path = join(f.target, kind === "tracked" ? "SKILL.md" : "my-notes.md");
  if (kind === "ignored") writeFileSync(join(f.target, ".git", "info", "exclude"), "my-notes.md\n");
  writeFileSync(path, "my changes\n");
  const before = f.git(["-C", f.target, "rev-parse", "HEAD"], 10_000);
  let pulled = false;
  const result = await installSkillRepository(f.root, "owner/repo", (args, timeout) => {
    if (args.includes("pull")) pulled = true;
    return f.transport(args, timeout);
  });
  expect(result.success).toBe(false);
  expect(result.message).toContain("Local changes or untracked files");
  expect(pulled).toBe(false);
  expect(readFileSync(path, "utf8")).toBe("my changes\n");
  expect(f.git(["-C", f.target, "rev-parse", "HEAD"], 10_000)).toBe(before);
}));

it("keeps the previous checkout after offline update and supports a later fast-forward", () => fixture(async f => {
  expect((await f.install()).success).toBe(true);
  const before = f.git(["-C", f.target, "rev-parse", "HEAD"], 10_000);
  const failed = await installSkillRepository(f.root, "owner/repo", (args, timeout) => {
    if (args.includes("pull")) throw new Error("fixture offline");
    return f.transport(args, timeout);
  });
  expect(failed.success).toBe(false);
  expect(failed.message).toContain("fixture offline");
  expect(f.git(["-C", f.target, "rev-parse", "HEAD"], 10_000)).toBe(before);
  writeFileSync(join(f.upstream, "SKILL.md"), "new upstream\n");
  f.git(["-C", f.upstream, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-am", "update"], 10_000);
  expect((await f.install()).success).toBe(true);
  expect(readFileSync(join(f.target, "SKILL.md"), "utf8").trim()).toBe("new upstream");
}));

it("rejects diverged history without resetting local commits", () => fixture(async f => {
  expect((await f.install()).success).toBe(true);
  for (const [dir, content] of [[f.upstream, "remote"], [f.target, "local"]]) {
    writeFileSync(join(dir!, "SKILL.md"), content!);
    f.git(["-C", dir!, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-am", content!], 10_000);
  }
  const before = f.git(["-C", f.target, "rev-parse", "HEAD"], 10_000);
  expect((await f.install()).success).toBe(false);
  expect(f.git(["-C", f.target, "rev-parse", "HEAD"], 10_000)).toBe(before);
  expect(readFileSync(join(f.target, "SKILL.md"), "utf8")).toBe("local");
}));

it("rejects a repository name collision with a different origin", () => fixture(async f => {
  expect((await f.install()).success).toBe(true);
  f.git(["-C", f.target, "remote", "set-url", "origin", "https://github.com/another/project.git"], 10_000);
  const result = await f.install();
  expect(result.success).toBe(false);
  expect(result.message).toContain("origin differs");
  expect(existsSync(join(f.target, "SKILL.md"))).toBe(true);
}));

it.skipIf(process.platform !== "win32")("accepts Windows directory aliases when Git reports a different path spelling", () => fixture(async f => {
  expect((await f.install()).success).toBe(true);
  const result = await installSkillRepository(f.root, "owner/repo", async (args, timeout) => {
    const output = await f.transport(args, timeout);
    return args.includes("--show-toplevel") ? output.toUpperCase() : output;
  });
  expect(result.success).toBe(true);
}));

it("does not treat a plain subdirectory of a Git repo as its own installation", () => fixture(async f => {
  mkdirSync(f.target, { recursive: true });
  writeFileSync(join(f.target, "notes"), "preserve");
  f.git(["init", f.root], 10_000);
  const result = await f.install();
  expect(result.success).toBe(false);
  expect(result.message).toContain("not its own Git repository");
  expect(readFileSync(join(f.target, "notes"), "utf8")).toBe("preserve");
}));

it("hides and cleans partial clones, then permits retry", () => fixture(async f => {
  const previous = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_SKILLS_DIR = f.root;
  try {
    const failed = await installSkillRepository(f.root, "owner/repo", args => {
      expect(args[0]).toBe("clone");
      writeFileSync(join(args.at(-1)!, "SKILL.md"), "partial");
      expect(skillPaths()).toEqual([]);
      throw new Error("fixture interrupted clone");
    });
    expect(failed.success).toBe(false);
    expect(existsSync(f.target)).toBe(false);
    expect(readdirSync(f.root)).toEqual([]);
    expect((await f.install()).success).toBe(true);
    expect(skillPaths()).toEqual([f.target]);
  } finally {
    if (previous === undefined) delete process.env.OHQUANT_SKILLS_DIR;
    else process.env.OHQUANT_SKILLS_DIR = previous;
  }
}));

it.each(["../repo", "owner/..", "owner/repo/extra", "--owner/repo", "owner/repo;echo"])("rejects invalid repository %s before Git or filesystem work", async repo => {
  const result = await installSkillRepository("unused", repo, () => { throw new Error("Git must not run"); });
  expect(result.success).toBe(false);
  expect(result.message).toContain("owner/repo format");
});

it("returns a failed install when real Git cannot clone the source", () => fixture(async f => {
  const result = await installSkillRepository(f.root, "owner/repo", (args, timeout) => {
    const local = [...args];
    if (args[0] === "clone") local[local.length - 2] = join(f.upstream, "missing.git");
    return f.git(local, timeout);
  });
  expect(result.success).toBe(false);
  expect(existsSync(f.target)).toBe(false);
  expect(readdirSync(f.root)).toEqual([]);
}));

it("preserves a destination created while the new clone is being prepared", () => fixture(async f => {
  const result = await installSkillRepository(f.root, "owner/repo", (args, timeout) => {
    const output = f.transport(args, timeout);
    if (args[0] === "clone") {
      mkdirSync(f.target);
      writeFileSync(join(f.target, "local-note"), "keep");
    }
    return output;
  });
  expect(result.success).toBe(false);
  expect(result.message).toContain("Another installation");
  expect(readFileSync(join(f.target, "local-note"), "utf8")).toBe("keep");
  expect(readdirSync(f.root)).toEqual(["owner-repo"]);
}));

it("rejects overlapping installs and never publishes a clone cancelled during preparation", () => fixture(async f => {
  const abort = new AbortController();
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  const install = installSkillRepository(f.root, "owner/repo", async (args, timeout) => {
    const result = await f.transport(args, timeout);
    if (args[0] === "clone") await paused;
    return result;
  }, abort.signal);
  try {
    const duplicate = await f.install();
    expect(duplicate.success).toBe(false);
    expect(duplicate.message).toContain("already running");
    abort.abort(); release();
    expect((await install).success).toBe(false);
    expect(existsSync(f.target)).toBe(false);
    expect(readdirSync(f.root)).toEqual([]);
    expect((await f.install()).success).toBe(true);
  } finally { abort.abort(); release(); await install; }
}));

it("installs the pinned commit after upstream advances, fast-forwards explicitly and refuses rollback", () => fixture(async f => {
  const first = await f.git(["-C", f.upstream, "rev-parse", "HEAD"], 10_000);
  writeFileSync(join(f.upstream, "SKILL.md"), "second\n");
  await f.git(["-C", f.upstream, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-am", "second"], 10_000);
  const second = await f.git(["-C", f.upstream, "rev-parse", "HEAD"], 10_000);
  const install = (revision: string) => installSkillRepository(f.root, "owner/repo", f.transport, undefined, { revision, requiredFiles: ["SKILL.md"] });
  expect((await install(first)).revision).toBe(first);
  expect(readFileSync(join(f.target, "SKILL.md"), "utf8").trim()).toBe("original");
  expect((await install(second)).revision).toBe(second);
  expect(readFileSync(join(f.target, "SKILL.md"), "utf8").trim()).toBe("second");
  expect((await install(first)).success).toBe(false);
  expect(await f.git(["-C", f.target, "rev-parse", "HEAD"], 10_000)).toBe(second);
}));

it("does not publish a pinned checkout with a missing core entry", () => fixture(async f => {
  const revision = await f.git(["-C", f.upstream, "rev-parse", "HEAD"], 10_000);
  const result = await installSkillRepository(f.root, "owner/repo", f.transport, undefined, { revision, requiredFiles: ["skills/missing/SKILL.md"] });
  expect(result.success).toBe(false);
  expect(result.message).toContain("entry is missing");
  expect(existsSync(f.target)).toBe(false);
  expect(readdirSync(f.root)).toEqual([]);
}));

it("rejects mutable refs and escaping entry paths before Git", async () => {
  for (const pin of [{ revision: "main", requiredFiles: ["SKILL.md"] }, { revision: "a".repeat(40), requiredFiles: ["skills/../../private"] }]) {
    let called = false;
    const result = await installSkillRepository("unused", "owner/repo", () => { called = true; return ""; }, undefined, pin);
    expect(result.success).toBe(false);
    expect(called).toBe(false);
  }
});

it("validates the pinned tree before changing an existing checkout", () => fixture(async f => {
  const initial = await f.install();
  expect(initial.success).toBe(true);
  rmSync(join(f.upstream, "SKILL.md"));
  writeFileSync(join(f.upstream, "README.md"), "entry removed");
  await f.git(["-C", f.upstream, "add", "."], 10_000);
  await f.git(["-C", f.upstream, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "remove entry"], 10_000);
  const revision = await f.git(["-C", f.upstream, "rev-parse", "HEAD"], 10_000);
  const result = await installSkillRepository(f.root, "owner/repo", f.transport, undefined, { revision, requiredFiles: ["SKILL.md"] });
  expect(result.success).toBe(false);
  expect(await f.git(["-C", f.target, "rev-parse", "HEAD"], 10_000)).toBe(initial.revision!);
  expect(readFileSync(join(f.target, "SKILL.md"), "utf8").trim()).toBe("original");
}));
