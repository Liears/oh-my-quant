import { expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkSkillPython, readSkillPython, skillPythonRevision } from "../python-probe.ts";
import { runPython } from "../../source/src/akshare-python.ts";

const response = (version: string) => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python", packages: { requests: version, yfinance: null, "pandas-market-calendars": null } }), stderr: "" });

it.skipIf(!Bun.which("py") && !Bun.which("python3") && !Bun.which("python"))("runs the generated import script with real Python, separating a broken import and suppressing its diagnostics", async () => {
  const cwd = join(tmpdir(), `whyj-python-import-script-${randomUUID()}`);
  const prelude = ["import importlib, types", "from importlib import metadata",
    "metadata.version = lambda name: {'requests': '2.32.0', 'yfinance': '1.4.0', 'pandas-market-calendars': '5.2.2'}[name]",
    "def fixture_import(name):", "    print('PRIVATE_IMPORT_DIAGNOSTIC')",
    "    if name == 'requests': raise ImportError('PRIVATE_IMPORT_DIAGNOSTIC')",
    "    if name == 'pandas_market_calendars': raise RuntimeError('PRIVATE_IMPORT_DIAGNOSTIC')",
    "    return types.SimpleNamespace()", "importlib.import_module = fixture_import"].join("\n");
  const result = await checkSkillPython(cwd, undefined, (script, args, options) => runPython(prelude + "\n" + script, args, options),
    ["requests", "yfinance", "pandas-market-calendars"]);
  expect(result.status).toBe("observed");
  expect(result.imports).toEqual({ requests: { status: "missing", error: "ImportError" },
    yfinance: { status: "available" }, "pandas-market-calendars": { status: "missing", error: "RuntimeError" } });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_IMPORT_DIAGNOSTIC");
});

it("collects explicit import results separately from versions without exposing import diagnostics", async () => {
  const cwd = join(tmpdir(), `whyj-python-import-probe-${randomUUID()}`);
  const result = await checkSkillPython(cwd, undefined, async (script, args, options) => {
    expect(script).toContain("importlib.import_module");
    expect(script).not.toContain("pip install");
    expect(script).not.toContain("str(error)");
    expect(options?.timeoutMs).toBe(10000); expect(args).toEqual([]);
    return { stdout: JSON.stringify({ ...JSON.parse(response("2.32.0").stdout),
      imports: { requests: { status: "missing", error: "ImportError" } } }), stderr: "PRIVATE_IMPORT_DIAGNOSTIC" };
  }, ["requests"]);
  expect(result.imports?.requests).toEqual({ status: "missing", error: "ImportError" });
  expect(JSON.stringify(readSkillPython(cwd))).not.toContain("PRIVATE_IMPORT_DIAGNOSTIC");
});

it("rejects unsupported imports before launching and revokes success on malformed or failed import checks", async () => {
  const cwd = join(tmpdir(), `whyj-python-import-probe-${randomUUID()}`);
  let launches = 0;
  const success = async () => { launches++; return { stdout: JSON.stringify({ ...JSON.parse(response("2.32.0").stdout),
    imports: { requests: { status: "available" } } }), stderr: "" }; };
  for (const names of [["arbitrary_workflow"], ["requests", "requests"]])
    await expect(checkSkillPython(cwd, undefined, success, names)).rejects.toThrow("Unsupported");
  expect(launches).toBe(0);
  await checkSkillPython(cwd, undefined, success, ["requests"]);
  expect(readSkillPython(cwd)?.imports?.requests?.status).toBe("available");
  for (const imports of [undefined, {}, { requests: { status: "available", error: "PRIVATE_DIAGNOSTIC" } },
    { requests: { status: "missing", error: "PRIVATE_DIAGNOSTIC" } }]) {
    await checkSkillPython(cwd, undefined, async () => ({ stdout: JSON.stringify({ ...JSON.parse(response("2.32.0").stdout), imports }), stderr: "" }), ["requests"]);
    expect(readSkillPython(cwd)?.status).toBe("unavailable");
    expect(JSON.stringify(readSkillPython(cwd))).not.toContain("PRIVATE_DIAGNOSTIC");
  }
  await checkSkillPython(cwd, undefined, async () => { throw new Error("PRIVATE_DIAGNOSTIC"); }, ["requests"]);
  expect(readSkillPython(cwd)?.status).toBe("unavailable");
  expect(JSON.stringify(readSkillPython(cwd))).not.toContain("PRIVATE_DIAGNOSTIC");
});

it("keeps the requested import scope and ignores late results while metadata-only checks revoke import evidence", async () => {
  const cwd = join(tmpdir(), `whyj-python-import-probe-${randomUUID()}`);
  const names = ["requests"];
  let release!: (value: ReturnType<typeof response>) => void;
  const pending = checkSkillPython(cwd, undefined, async () => new Promise(resolve => { release = resolve; }), names);
  names.push("arbitrary_workflow");
  release({ stdout: JSON.stringify({ ...JSON.parse(response("2.32.0").stdout), imports: { requests: { status: "available" } } }), stderr: "" });
  expect((await pending).imports).toEqual({ requests: { status: "available" } });
  const revision = skillPythonRevision(cwd);
  const controller = new AbortController();
  await expect(checkSkillPython(cwd, controller.signal, async () => { controller.abort(); return response("2.33.0"); }, ["requests"])).rejects.toThrow();
  expect(skillPythonRevision(cwd)).toBe(revision);
  expect(readSkillPython(cwd)?.imports?.requests?.status).toBe("available");
  const old = checkSkillPython(cwd, undefined, async () => new Promise(resolve => { release = resolve; }), ["requests"]);
  await checkSkillPython(cwd, undefined, async () => response("2.34.0"));
  release({ stdout: JSON.stringify({ ...JSON.parse(response("2.32.0").stdout), imports: { requests: { status: "available" } } }), stderr: "" });
  await old;
  expect(readSkillPython(cwd)?.packages.requests).toBe("2.34.0");
  expect(readSkillPython(cwd)?.imports).toBeUndefined();
});

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
