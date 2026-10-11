/** One monotonic deadline for a provider fallback chain; external cancellation remains distinct. */
export class ProviderBudget {
  readonly signal: AbortSignal | undefined;
  private readonly controller: AbortController | undefined;
  private readonly timer: ReturnType<typeof setTimeout> | undefined;
  private readonly deadline: number | undefined;

  constructor(private readonly external: AbortSignal | undefined, budgetMs: number | undefined) {
    if (budgetMs !== undefined) {
      if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 2_147_483_647)
        throw new Error("Provider budget must be a positive timer-safe integer.");
      this.controller = new AbortController();
      this.deadline = performance.now() + budgetMs;
      this.timer = setTimeout(() => this.controller!.abort(new Error("Provider request timed out")), budgetMs);
    }
    this.signal = external && this.controller ? AbortSignal.any([external, this.controller.signal])
      : external ?? this.controller?.signal;
  }

  get exhausted(): boolean {
    this.external?.throwIfAborted();
    if (this.deadline !== undefined && performance.now() >= this.deadline && !this.controller!.signal.aborted)
      this.controller!.abort(new Error("Provider request timed out"));
    return this.controller?.signal.aborted ?? false;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.exhausted) throw this.controller!.signal.reason;
    const pending = operation();
    if (!this.signal) return pending;
    return new Promise<T>((resolve, reject) => {
      const abort = () => { this.signal!.removeEventListener("abort", abort); reject(this.signal!.reason); };
      this.signal!.addEventListener("abort", abort, { once: true });
      pending.then(value => { this.signal!.removeEventListener("abort", abort); resolve(value); },
        error => { this.signal!.removeEventListener("abort", abort); reject(error); });
      if (this.signal!.aborted) abort();
    });
  }

  close(): void { if (this.timer) clearTimeout(this.timer); }
}
