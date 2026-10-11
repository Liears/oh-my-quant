import type { AlphaEngineStatus } from "../../types/alpha.ts";
import { runJsonProcess } from "../process.ts";
import { AlphaEngineError } from "../types.ts";
import { AKQUANT_RULE_VERSION, AKQUANT_VERSION, record } from "../validation.ts";
import type { AkquantOptions } from "./akquant.ts";

const PROBE = String.raw`
import contextlib, importlib.metadata, json, platform, sys
result = {"status": "unavailable", "requiredVersion": "0.3.58", "python": platform.python_version()}
try:
    result["version"] = importlib.metadata.version("akquant")
    if result["version"] != "0.3.58":
        result["status"] = "version"
    else:
        with contextlib.redirect_stdout(sys.stderr):
            import akquant as aq
        result["ruleVersion"] = aq.__engine_rule_version__
        result["status"] = "ready" if result["ruleVersion"] == "1.5.4" else "version"
except Exception:
    pass
print(json.dumps(result))
`;

export async function checkAkquantEngine(options: AkquantOptions, signal?: AbortSignal): Promise<AlphaEngineStatus> {
  try {
    const output = await (options.runProcess ?? runJsonProcess)({ command: options.python.command,
      args: [...(options.python.args ?? []), "-I", "-X", "utf8", "-c", PROBE], input: "{}", timeoutMs: options.timeoutMs ?? 30_000, signal });
    if (signal?.aborted) return { status: "cancelled", requiredVersion: AKQUANT_VERSION };
    const raw = record(JSON.parse(output), ["status", "requiredVersion", "version", "ruleVersion", "python"], "output");
    if (!["ready", "unavailable", "version"].includes(String(raw.status)) || raw.requiredVersion !== AKQUANT_VERSION
      || typeof raw.python !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.python)
      || (raw.version !== undefined && (typeof raw.version !== "string" || !/^[\w.+-]{1,64}$/.test(raw.version)))
      || (raw.ruleVersion !== undefined && (typeof raw.ruleVersion !== "string" || !/^[\w.+-]{1,64}$/.test(raw.ruleVersion)))
      || (raw.status === "ready" && (raw.version !== AKQUANT_VERSION || raw.ruleVersion !== AKQUANT_RULE_VERSION)))
      throw new AlphaEngineError("output", "Invalid alpha dependency response.");
    return raw as unknown as AlphaEngineStatus;
  } catch (error) {
    return { status: signal?.aborted ? "cancelled" : error instanceof AlphaEngineError && error.code !== "input" ? error.code : "output", requiredVersion: AKQUANT_VERSION };
  }
}
