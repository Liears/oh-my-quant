import { runPython } from "./akshare-python.ts";
import type { RunPythonOptions } from "./akshare-python.ts";
import type { PythonReadiness } from "../../types/data-readiness.ts";

/** Network-free checks in the same interpreter as market requests; never installs dependencies. */
export async function checkAkshareDependency(options: RunPythonOptions & { javascript?: boolean } = {}): Promise<PythonReadiness> {
  try {
    const { stdout } = await runPython([
      "import json, platform, sys",
      "result = {'python': platform.python_version()}",
      "try:",
      "    import akshare as ak",
      "    result.update(status='ready', akshare=str(getattr(ak, '__version__', 'unknown')))",
      "    if 'javascript' in sys.argv[1:]:",
      "        try:",
      "            from py_mini_racer import MiniRacer",
      "            with MiniRacer() as engine:",
      "                if engine.eval('1 + 1') != 2:",
      "                    raise RuntimeError('Invalid JavaScript runtime response')",
      "            result['javascript'] = {'status': 'ready'}",
      "        except ImportError:",
      "            result['javascript'] = {'status': 'missing-package'}",
      "        except Exception as error:",
      "            blocked = isinstance(error, OSError) and getattr(error, 'winerror', None) == 4551",
      "            result['javascript'] = {'status': 'blocked', 'winerror': 4551} if blocked else {'status': 'unavailable'}",
      "except ImportError:",
      "    result['status'] = 'missing-package'",
      "print(json.dumps(result))",
    ].join("\n"), options.javascript ? ["javascript"] : [], options);
    const result: unknown = JSON.parse(stdout.trim());
    if (!result || typeof result !== "object" || !("status" in result)
      || (result.status !== "ready" && result.status !== "missing-package")) throw new Error("Invalid dependency probe response");
    const readiness: PythonReadiness = { status: result.status,
      python: "python" in result && typeof result.python === "string" ? result.python : undefined,
      akshare: "akshare" in result && typeof result.akshare === "string" ? result.akshare : undefined };
    if (options.javascript && readiness.status === "ready") {
      const runtime = "javascript" in result ? result.javascript : null;
      if (!runtime || typeof runtime !== "object" || !("status" in runtime)
        || (runtime.status !== "ready" && runtime.status !== "blocked" && runtime.status !== "missing-package" && runtime.status !== "unavailable")
        || (runtime.status === "blocked" && (!("winerror" in runtime) || runtime.winerror !== 4551)))
        throw new Error("Invalid dependency probe response");
      readiness.javascript = { status: runtime.status,
        ...(runtime.status === "blocked" ? { winerror: 4551 } : {}) };
    }
    return readiness;
  } catch (error) {
    options.signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing-python" };
    throw error;
  }
}
