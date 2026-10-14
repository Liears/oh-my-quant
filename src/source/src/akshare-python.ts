import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type PythonCandidate = { command: string; args: string[] };

export interface RunPythonOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function runPython(
  script: string,
  args: string[] = [],
  options: RunPythonOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const candidates = getPythonCandidates();
    let index = 0;

    const attempt = () => {
      if (options.signal?.aborted) { reject(options.signal.reason); return; }
      const candidate = candidates[index++];
      if (!candidate) {
        reject(new Error(`AKShare failed (python unavailable): ${pythonAvailabilityMessage()}`));
        return;
      }

      let failedToSpawn = false;
      let stdout = "";
      let stderr = "";
      const proc = spawn(candidate.command, [...candidate.args, "-c", script, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        signal: options.signal,
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
        timeout: timeoutMs,
      });

      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

      proc.on("close", (code) => {
        if (failedToSpawn) return;
        if (code === 0) {
          resolvePromise({ stdout, stderr });
          return;
        }
        const reason = code == null ? `timeout after ${timeoutMs}ms` : `exit ${code}`;
        reject(new Error(`AKShare failed (${reason}): ${stderr || stdout}`));
      });

      proc.on("error", (err: NodeJS.ErrnoException) => {
        failedToSpawn = true;
        if (err.code === "ENOENT" && index < candidates.length) {
          attempt();
          return;
        }
        reject(err);
      });
    };

    attempt();
  });
}

function getPythonCandidates(): PythonCandidate[] {
  const root = packageRoot();
  const venvCandidates = process.platform === "win32"
    ? [
      resolve(root, ".venv/Scripts/python.exe"),
      resolve(root, ".venv/Scripts/python"),
      resolve(root, ".venv/python.exe"),
      resolve(root, ".venv/python"),
    ]
    : [
      resolve(root, ".venv/bin/python"),
      resolve(root, ".venv/bin/python3"),
      resolve(root, ".venv/bin/python.exe"),
    ];

  const candidates: PythonCandidate[] = [];
  for (const command of venvCandidates) {
    if (existsSync(command)) {
      candidates.push({ command, args: [] });
    }
  }

  candidates.push(
    { command: "py", args: ["-3"] },
    { command: "python3", args: [] },
    { command: "python", args: [] },
  );

  return candidates;
}

function pythonAvailabilityMessage(): string {
  const root = packageRoot();
  return [
    resolve(root, ".venv/Scripts/python.exe"),
    resolve(root, ".venv/Scripts/python"),
    resolve(root, ".venv/bin/python"),
    resolve(root, ".venv/bin/python3"),
    "py -3",
    "python3",
    "python",
  ].join(", ");
}

// Resolve the same package in both src/source/src and the bundled dist entry.
function packageRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(current, "package.json"))) {
    const parent = dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
  return current;
}
