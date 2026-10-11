import { expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkSkillPython, readSkillPython, skillPythonRevision } from "./python-probe.ts";

const response = (version: string) => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python", packages: { requests: version, yfinance: null, "pandas-market-calendars": null } }), stderr: "" });

it("publishes version-only evidence without imports or installation and rejects malformed metadata", async () => {
  const cwd = join(tmpdir(), `whyj-python-probe-${randomUUID()}`);
  const result = await checkSkillPython(cwd, undefined, async (script, args, options) => {
    expect(script).toContain("metadata.version");
    expect(script).not.toMatch(/import requests|import yfinance|pip install/);
    expect(args).toEqual([]); expect(options?.timeoutMs).toBe(10000);
    return response("2.32.0");
  });
  expect(result).toMatchObject({ status: "observed", python: "3.12.1", packages: { requests: "2.32.0", yfinance: null } });
  result.packages.requests = "mutated outside";
  expect(readSkillPython(cwd)?.packages.requests).toBe("2.32.0");
  expect(skillPythonRevision(cwd)).toBe(1);
  await checkSkillPython(cwd, undefined, async () => ({ stdout: '{"python":"3.12"}', stderr: "" }));
  expect(readSkillPython(cwd)?.status).toBe("unavailable");
  expect(skillPythonRevision(cwd)).toBe(2);
  await checkSkillPython(cwd, undefined, async () => { throw Object.assign(new Error("spawn python ENOENT"), { code: "ENOENT" }); });
  expect(readSkillPython(cwd)?.status).toBe("missing-python");
});

it("ignores superseded checks and cancellation does not replace existing evidence", async () => {
  const cwd = join(tmpdir(), `whyj-python-probe-${randomUUID()}`);
  let release!: (result: ReturnType<typeof response>) => void;
  const old = checkSkillPython(cwd, undefined, async () => new Promise(resolve => { release = resolve; }));
  await checkSkillPython(cwd, undefined, async () => response("2.33.0"));
  release(response("2.31.0")); await old;
  expect(readSkillPython(cwd)?.packages.requests).toBe("2.33.0");
  const revision = skillPythonRevision(cwd), abort = new AbortController();
  await expect(checkSkillPython(cwd, abort.signal, async (_script, _args, options) => {
    expect(options?.signal).toBe(abort.signal); abort.abort(); return response("2.34.0");
  })).rejects.toThrow();
  expect(skillPythonRevision(cwd)).toBe(revision);
  expect(readSkillPython(cwd)?.packages.requests).toBe("2.33.0");
});
