/** A round deadline is checked at async boundaries as well as by its cancellation timer. */
export class OverviewBudget {
  private readonly controller: AbortController;
  private readonly deadline: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  timedOut = false;

  constructor(controller: AbortController, startedAt: number, timeoutMs: number) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new Error("Overview timeout must be a positive timer-safe integer");
    this.controller = controller;
    this.deadline = startedAt + timeoutMs;
    this.timer = setTimeout(() => this.expire(), Math.max(0, Math.ceil(this.deadline - performance.now())));
  }

  get signal(): AbortSignal { return this.controller.signal; }

  check(): void {
    if (performance.now() >= this.deadline) this.expire();
    this.signal.throwIfAborted();
  }

  close(): void { clearTimeout(this.timer); }

  private expire(): void {
    if (this.signal.aborted) return;
    this.timedOut = true;
    this.controller.abort(new Error("Overview market refresh timed out"));
  }
}
