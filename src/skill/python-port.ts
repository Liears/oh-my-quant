/** The host selects the interpreter and owns process execution; probes only supply fixed scripts. */
export type SkillPythonRunner = (
  script: string,
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal },
) => Promise<{ stdout: string; stderr: string }>;
