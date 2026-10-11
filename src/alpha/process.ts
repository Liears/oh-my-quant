import { spawn } from "node:child_process";
import { AlphaEngineError } from "./types.ts";

export interface JsonProcessRequest {
  command: string;
  args: string[];
  input: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** No shell, no command-line payloads. Wait for close after kill so pipes are drained. */
export function runJsonProcess(request: JsonProcessRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    if (request.signal?.aborted) { reject(new AlphaEngineError("cancelled", "Alpha run cancelled.")); return; }
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 600_000) {
      reject(new AlphaEngineError("input", "Timeout must be 1 to 600000 milliseconds.")); return;
    }
    const proc = spawn(request.command, request.args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    let bytes = 0, stderrBytes = 0, failure: AlphaEngineError | undefined;
    const stop = (error: AlphaEngineError) => { failure ??= error; proc.kill("SIGKILL"); };
    const abort = () => stop(new AlphaEngineError("cancelled", "Alpha run cancelled."));
    const timer = setTimeout(() => stop(new AlphaEngineError("timeout", "Alpha engine deadline exceeded.")), request.timeoutMs);
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) abort();
    proc.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) stop(new AlphaEngineError("output", "Alpha stdout exceeded 16 MiB."));
      else chunks.push(chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 256 * 1024) stop(new AlphaEngineError("output", "Alpha stderr exceeded 256 KiB."));
    });
    proc.stdin.on("error", () => { failure ??= new AlphaEngineError("process", "Alpha input channel closed."); });
    proc.on("error", (error: NodeJS.ErrnoException) => {
      failure ??= new AlphaEngineError(error.code === "ENOENT" ? "unavailable" : "process", "Unable to start alpha engine.");
    });
    proc.on("close", code => {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new AlphaEngineError("process", "Alpha engine exited unsuccessfully; no result accepted."));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    proc.stdin.end(request.input);
  });
}
