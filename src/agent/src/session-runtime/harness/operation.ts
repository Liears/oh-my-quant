import { AgentHarnessError, type AgentHarnessPhase } from "./types.ts";

/** One lifetime covers preparation, streaming, persistence, and awaited listeners. */
export class HarnessOperation {
  phase: AgentHarnessPhase = "idle";
  private controller?: AbortController;
  private settled?: Promise<void>;

  start(phase: Exclude<AgentHarnessPhase, "idle">): () => void {
    if (this.phase !== "idle") throw new AgentHarnessError("busy", "AgentHarness is busy");
    this.phase = phase;
    this.controller = new AbortController();
    let resolve!: () => void;
    this.settled = new Promise<void>((done) => { resolve = done; });
    return () => {
      this.phase = "idle";
      this.controller = undefined;
      this.settled = undefined;
      resolve();
    };
  }

  get signal(): AbortSignal {
    if (!this.controller) throw new AgentHarnessError("invalid_state", "No active operation");
    return this.controller.signal;
  }

  abort(): void { this.controller?.abort(); }
  async waitForIdle(): Promise<void> { await this.settled; }
}
