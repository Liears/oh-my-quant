import { resolve } from "node:path";
import { runPython } from "../source/src/akshare-python.ts";

export interface SkillPythonEvidence {
  status: "observed" | "missing-python" | "unavailable";
  checkedAt: string;
  executable?: string;
  python?: string;
  packages: Record<string, string | null>;
  reason?: string;
}

const observations = new Map<string, SkillPythonEvidence>();
const requests = new Map<string, number>();
const revisions = new Map<string, number>();
const PACKAGES = ["requests", "yfinance", "pandas-market-calendars"] as const;
const SCRIPT = [
  "import json, platform, sys",
  "from importlib import metadata",
  "packages = {}",
  `for name in ${JSON.stringify(PACKAGES)}:`,
  "    try: packages[name] = metadata.version(name)",
  "    except metadata.PackageNotFoundError: packages[name] = None",
  "print(json.dumps({'python': platform.python_version(), 'executable': sys.executable, 'packages': packages}))",
].join("\n");

export function skillPythonRevision(cwd: string): number { return revisions.get(resolve(cwd)) ?? 0; }
export function readSkillPython(cwd: string): SkillPythonEvidence | undefined {
  return structuredClone(observations.get(resolve(cwd)));
}

/** Bounded, metadata-only check; no package installation, third-party imports or network. */
export async function checkSkillPython(cwd: string, signal?: AbortSignal, run: typeof runPython = runPython): Promise<SkillPythonEvidence> {
  signal?.throwIfAborted();
  const key = resolve(cwd), request = (requests.get(key) ?? 0) + 1;
  requests.set(key, request);
  let evidence: SkillPythonEvidence;
  try {
    const { stdout } = await run(SCRIPT, [], { timeoutMs: 10_000, signal });
    signal?.throwIfAborted();
    const value: unknown = JSON.parse(stdout);
    if (!value || typeof value !== "object" || !("python" in value) || typeof value.python !== "string"
      || !("executable" in value) || typeof value.executable !== "string" || !("packages" in value)
      || !value.packages || typeof value.packages !== "object") throw new Error("Invalid Python metadata response");
    const packages: Record<string, string | null> = {};
    for (const name of PACKAGES) {
      const version = Reflect.get(value.packages, name);
      if (version !== null && typeof version !== "string") throw new Error("Incomplete Python package metadata");
      packages[name] = version;
    }
    evidence = { status: "observed", checkedAt: new Date().toISOString(), executable: value.executable, python: value.python, packages };
  } catch (error) {
    signal?.throwIfAborted();
    const missing = error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
    evidence = { status: missing ? "missing-python" : "unavailable", checkedAt: new Date().toISOString(), packages: {}, reason: error instanceof Error ? error.message : String(error) };
  }
  if (requests.get(key) === request) {
    observations.set(key, evidence);
    revisions.set(key, (revisions.get(key) ?? 0) + 1);
  }
  return structuredClone(evidence);
}
