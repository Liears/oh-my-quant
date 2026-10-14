import { resolve } from "node:path";
import type { SkillPythonRunner } from "./python-port.ts";

export interface SkillPythonEvidence {
  status: "observed" | "missing-python" | "unavailable";
  checkedAt: string;
  executable?: string;
  python?: string;
  packages: Record<string, string | null>;
  imports?: Record<string, { status: "available" | "missing"; error?: string }>;
  reason?: string;
}

const observations = new Map<string, SkillPythonEvidence>();
const requests = new Map<string, number>();
const revisions = new Map<string, number>();
export const SKILL_PYTHON_PACKAGES = ["requests", "yfinance", "pandas-market-calendars"] as const;
const SCRIPT = [
  "import json, platform, sys",
  "from importlib import metadata",
  "packages = {}",
  `for name in ${JSON.stringify(SKILL_PYTHON_PACKAGES)}:`,
  "    try: packages[name] = metadata.version(name)",
  "    except metadata.PackageNotFoundError: packages[name] = None",
  "result = {'python': platform.python_version(), 'executable': sys.executable, 'packages': packages}",
].join("\n");

export function skillPythonRevision(cwd: string): number { return revisions.get(resolve(cwd)) ?? 0; }
export function readSkillPython(cwd: string): SkillPythonEvidence | undefined {
  return structuredClone(observations.get(resolve(cwd)));
}

/** Metadata by default. Explicit imports run only whitelisted installed packages, never skills or installers. */
export async function checkSkillPython(cwd: string, signal: AbortSignal | undefined, run: SkillPythonRunner,
  imports: readonly string[] = []): Promise<SkillPythonEvidence> {
  signal?.throwIfAborted();
  imports = [...imports];
  if (imports.some(name => !SKILL_PYTHON_PACKAGES.some(allowed => allowed === name)) || new Set(imports).size !== imports.length)
    throw new Error("Unsupported or duplicate Python import check");
  const key = resolve(cwd), request = (requests.get(key) ?? 0) + 1;
  requests.set(key, request);
  let evidence: SkillPythonEvidence;
  try {
    const script = [SCRIPT, ...(imports.length ? [
      "import importlib, contextlib, os",
      "sys.path = [path for path in sys.path if path and os.path.abspath(path) != os.getcwd()]",
      "result['imports'] = {}",
      `for name in ${JSON.stringify(imports)}:`,
      "    try:",
      "        with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):",
      "            importlib.import_module(name.replace('-', '_'))",
      "        result['imports'][name] = {'status': 'available'}",
      "    except Exception as error:",
      "        kind = type(error).__name__",
      "        if kind not in ('ImportError', 'ModuleNotFoundError', 'OSError', 'RuntimeError', 'ValueError', 'SyntaxError'): kind = 'ImportFailure'",
      "        result['imports'][name] = {'status': 'missing', 'error': kind}",
    ] : []), "print(json.dumps(result))"].join("\n");
    const { stdout } = await run(script, [], { timeoutMs: 10_000, signal });
    signal?.throwIfAborted();
    if (stdout.length > 16_384) throw new Error("Oversized Python metadata response");
    const value: unknown = JSON.parse(stdout);
    if (!value || typeof value !== "object" || !("python" in value) || typeof value.python !== "string"
      || !("executable" in value) || typeof value.executable !== "string" || !("packages" in value)
      || !value.packages || typeof value.packages !== "object") throw new Error("Invalid Python metadata response");
    const packages: Record<string, string | null> = {};
    for (const name of SKILL_PYTHON_PACKAGES) {
      const version = Reflect.get(value.packages, name);
      if (version !== null && typeof version !== "string") throw new Error("Incomplete Python package metadata");
      packages[name] = version;
    }
    evidence = { status: "observed", checkedAt: new Date().toISOString(), executable: value.executable, python: value.python, packages };
    if (imports.length) {
      if (!("imports" in value) || !value.imports || typeof value.imports !== "object") throw new Error("Missing Python import response");
      const results: NonNullable<SkillPythonEvidence["imports"]> = {};
      for (const name of imports) {
        const result: unknown = Reflect.get(value.imports, name);
        if (!result || typeof result !== "object" || !("status" in result)
          || result.status !== "available" && result.status !== "missing") throw new Error("Invalid Python import response");
        const error = "error" in result ? result.error : undefined;
        if (result.status === "available" && error !== undefined || result.status === "missing"
          && (typeof error !== "string" || !["ImportError", "ModuleNotFoundError", "OSError", "RuntimeError", "ValueError", "SyntaxError", "ImportFailure"].includes(error)))
          throw new Error("Invalid Python import outcome");
        results[name] = { status: result.status, ...(typeof error === "string" ? { error } : {}) };
      }
      evidence.imports = results;
    }
  } catch (error) {
    signal?.throwIfAborted();
    const missing = error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
    evidence = { status: missing ? "missing-python" : "unavailable", checkedAt: new Date().toISOString(), packages: {},
      reason: imports.length ? "Python import check did not complete with a valid response; retry --check-imports."
        : error instanceof Error ? error.message : String(error) };
  }
  if (requests.get(key) === request) {
    observations.set(key, evidence);
    revisions.set(key, (revisions.get(key) ?? 0) + 1);
  }
  return structuredClone(evidence);
}
