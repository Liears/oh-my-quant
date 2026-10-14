import { runPython } from "../../source/src/akshare-python.ts";
import { checkSkillPython as inspectPython, checkSkillNetwork as inspectNetwork, checkEtfNetwork as inspectEtf } from "../../skill/index.ts";

/** Bind skill probes to the same interpreter selection as market-data operations. */
export function checkSkillPython(cwd: string, signal?: AbortSignal, imports: readonly string[] = []) {
  return inspectPython(cwd, signal, runPython, imports);
}

export function checkSkillNetwork(cwd: string, signal?: AbortSignal) {
  return inspectNetwork(cwd, signal, runPython);
}

export function checkEtfNetwork(cwd: string, signal?: AbortSignal) {
  return inspectEtf(cwd, signal, runPython);
}
