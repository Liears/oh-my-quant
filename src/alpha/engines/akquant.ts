import { validateAlphaResult } from "../backtest.ts";
import { runJsonProcess, type JsonProcessRequest } from "../process.ts";
import { AlphaEngineError, type AlphaBacktestEngine } from "../types.ts";
import { prepareAlphaRequest } from "../validation.ts";
import { AKQUANT_SCRIPT } from "./akquant-script.ts";

export interface AkquantOptions {
  python: { command: string; args?: string[] };
  timeoutMs?: number;
  runProcess?: (request: JsonProcessRequest) => Promise<string>;
}

export function createAkquantEngine(options: AkquantOptions): AlphaBacktestEngine {
  const command = options.python.command, args = [...(options.python.args ?? [])];
  const timeoutMs = options.timeoutMs ?? 60_000;
  const runProcess = options.runProcess ?? runJsonProcess;
  return { async run(input, signal) {
    if (signal?.aborted) throw new AlphaEngineError("cancelled", "Alpha run cancelled.");
    const prepared = prepareAlphaRequest(input);
    const output = await runProcess({ command, args: [...args, "-I", "-X", "utf8", "-c", AKQUANT_SCRIPT],
      input: JSON.stringify(prepared), timeoutMs, signal });
    if (signal?.aborted) throw new AlphaEngineError("cancelled", "Alpha run cancelled.");
    return validateAlphaResult(output, prepared.request, prepared.signals, prepared.inputHash);
  } };
}
