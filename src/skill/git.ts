import { execFile, spawn } from "node:child_process";

/** Wait for close (and tree termination), not merely the abort/error notification. */
export function runSkillGit(args: string[], timeout: number, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { stdio: "pipe", windowsHide: true, detached: process.platform !== "win32",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let output = "", errors = "", failure: Error | undefined;
    let termination: Promise<void> | undefined;
    const stop = (reason: Error) => {
      if (termination) return;
      failure = reason;
      termination = new Promise(done => {
        if (!child.pid) { done(); return; }
        if (process.platform === "win32") {
          execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 }, () => { child.kill(); done(); });
        } else {
          try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
          done();
        }
      });
    };
    const abort = () => stop(new Error("Skill installation cancelled."));
    const timer = setTimeout(() => stop(new Error(`Git timed out after ${timeout} ms.`)), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); if (output.length > 1_000_000) stop(new Error("Git output exceeded its limit.")); });
    child.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-8_000); });
    child.on("error", error => { failure ??= error; });
    child.on("close", code => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void (termination ?? Promise.resolve()).then(() => {
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(errors.trim() || `Git exited with code ${code}.`));
        else resolve(output.trim());
      });
    });
  });
}
