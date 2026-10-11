import { defaultToolProbeRequest, probeToolEndpoint, toolProbeChoices, type ToolProbeOptions } from "./tool-probe.ts";
import type { OhQuantSettings } from "../types/config.ts";
import type { DataMarket } from "../types/data-readiness.ts";
import type { ToolProbeRequest, ToolProbeResult } from "../types/tool-probe.ts";

export interface ToolProbeContext extends Omit<ToolProbeOptions, "signal"> {
  settings: OhQuantSettings;
  market: DataMarket;
  onChange?: () => void;
  probe?: typeof probeToolEndpoint;
}

/** Per-editor evidence: changing input, closing, or replacing the editor cancels the check. */
export class ToolProbeDraft {
  private readonly settings: OhQuantSettings;
  private input: ToolProbeRequest | null;
  private controller: AbortController | null = null;
  private disposed = false;
  private evidence: ToolProbeResult | null = null;
  private evidenceConnection: string | null = null;
  private message = "Review endpoint and parameters, then check. Nothing is saved.";
  constructor(tool: string, private readonly context: ToolProbeContext) {
    this.settings = structuredClone(context.settings);
    this.input = defaultToolProbeRequest(this.settings, tool, context.market);
  }
  get request(): ToolProbeRequest | null { return this.input ? structuredClone(this.input) : null; }
  get choices() { return this.input ? toolProbeChoices(this.input.tool, this.input.market) : []; }
  get checking(): boolean { return this.controller !== null; }
  get result(): ToolProbeResult | null { return this.evidenceConnection === this.connection() && this.evidence ? structuredClone(this.evidence) : null; }
  get status(): string { return this.evidence && this.evidenceConnection !== this.connection() ? "Connection changed. Check this endpoint again." : this.message; }
  private connection(): string { return JSON.stringify({ ...(this.context.processEnv ?? process.env), ...this.settings.env }); }
  select(index: number): void {
    const choice = this.choices[index];
    if (!choice || !this.input) return;
    this.cancel(); this.evidence = null;
    this.input = { ...this.input, provider: choice.provider, endpoint: choice.endpoint,
      params: choice.endpoint === this.input.endpoint ? this.input.params : {} };
    this.message = "Endpoint changed. Review its parameters.";
  }
  setParams(json: string): void {
    let params: unknown;
    try { params = JSON.parse(json); } catch { throw new Error("Enter a JSON object of endpoint parameters."); }
    if (!params || typeof params !== "object" || Array.isArray(params) || Object.values(params).some(value => !["string", "number", "boolean"].includes(typeof value)))
      throw new Error("Use a flat JSON object with string, number or boolean values.");
    if (!this.input) return;
    this.cancel(); this.evidence = null;
    this.input.params = params as ToolProbeRequest["params"];
    this.message = "Parameters changed. Check this request again.";
  }
  setError(message: string): void { this.message = message; }
  cancel(): void {
    const controller = this.controller; this.controller = null;
    if (controller) { controller.abort(); this.evidence = null; this.message = "Check cancelled. Nothing saved."; }
  }
  dispose(): void { this.disposed = true; this.cancel(); }
  async verify(): Promise<void> {
    if (this.disposed || !this.input) return;
    this.cancel(); this.evidence = null;
    const controller = new AbortController(); this.controller = controller;
    const connection = this.connection(); this.message = "Checking one endpoint · Esc cancels"; this.context.onChange?.();
    let abort: (() => void) | undefined;
    try {
      const result = await Promise.race([
        (this.context.probe ?? probeToolEndpoint)(this.settings, this.request!, { ...this.context,
          processEnv: { ...(this.context.processEnv ?? process.env) }, signal: controller.signal }),
        new Promise<null>(resolve => { abort = () => resolve(null); controller.signal.addEventListener("abort", abort, { once: true }); }),
      ]);
      if (this.disposed || this.controller !== controller || !result) return;
      this.evidence = structuredClone(result); this.evidenceConnection = connection; this.message = result.detail;
    } catch { if (this.controller === controller) this.message = "Endpoint check failed. Review parameters and retry."; }
    finally {
      if (abort) controller.signal.removeEventListener("abort", abort);
      if (this.controller === controller) { this.controller = null; this.context.onChange?.(); }
    }
  }
}
