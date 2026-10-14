import { expect, test } from "bun:test";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

test("skill public services run without Agent, runtime, CLI, market providers or application storage", () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-isolated-skill-"));
  try {
    cpSync(resolve(import.meta.dir, ".."), join(root, "skill"), {
      recursive: true, filter: source => basename(source) !== "test",
    });
    mkdirSync(join(root, "types"));
    copyFileSync(resolve(import.meta.dir, "../../types/skills.ts"), join(root, "types/skills.ts"));
    writeFileSync(join(root, "host.ts"), `
import { checkSkillPython, readSkillPython, inspectSkillReadiness, installSkillRepository } from "./skill/index.ts";
let calls = 0;
const controller = new AbortController();
const before = readSkillPython(process.cwd());
const observed = await checkSkillPython(process.cwd(), controller.signal, async (_script, args, options) => {
  calls++;
  if (options.signal !== controller.signal || options.timeoutMs !== 10000 || args.length) throw new Error("Port contract changed");
  return { stdout: JSON.stringify({ python: "3.12.1", executable: "host-owned-python", packages: {
    requests: "2.32.0", yfinance: null, "pandas-market-calendars": null,
  } }), stderr: "" };
});
const readiness = inspectSkillReadiness([{ name: "local", requires: ["python>=3.9"], optional: [] }], {}, observed);
const invalid = await installSkillRepository("must-not-exist", "invalid", () => { throw new Error("No Git expected"); });
controller.abort();
let cancelled = false;
try { await checkSkillPython(process.cwd(), controller.signal, async () => { calls++; throw new Error("No execution expected"); }); }
catch { cancelled = true; }
console.log(JSON.stringify({ initial: before ?? null, calls, executable: observed.executable, readiness: readiness.status,
  invalidInstall: invalid.success, cancelled, retained: readSkillPython(process.cwd())?.executable }));
`);
    const before = readdirSync(root).sort();
    const child = Bun.spawnSync([process.execPath, join(root, "host.ts")], {
      cwd: root, env: { ...process.env, OHQUANT_DIR: join(root, "must-not-exist") },
      stdout: "pipe", stderr: "pipe", timeout: 10_000,
    });
    expect(new TextDecoder().decode(child.stderr)).toBe("");
    expect(child.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(child.stdout))).toEqual({ initial: null, calls: 1,
      executable: "host-owned-python", readiness: "requirements-met", invalidInstall: false,
      cancelled: true, retained: "host-owned-python" });
    expect(readdirSync(root).sort()).toEqual(before);
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected isolated skill fixture.");
    rmSync(root, { recursive: true, force: true });
  }
});
