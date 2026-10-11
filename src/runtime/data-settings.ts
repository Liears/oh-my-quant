import type { DataSource, OhQuantSettings } from "../types/config.ts";
import type { DataMarket, DataProbeRequest, DataReadiness } from "../types/data-readiness.ts";
import { dataCredentialKey, dataSourcesForMarket, defaultDataProbeRequest, probeDataConnection } from "./data-readiness.ts";
import { inspectToolReadiness } from "./tool-readiness.ts";
import type { ToolReadiness } from "../types/tool-capabilities.ts";
import type { ToolProbeContext } from "./tool-probe-draft.ts";

const ENDPOINT_KEYS: Record<DataSource, string | null> = {
  akshare: null, tushare: "TUSHARE_BASE_URL", "llmquant-data": "LLMQUANT_BASE_URL", "financial-datasets": "FINANCIAL_DATASETS_BASE_URL",
};
export interface DataSettingsOptions {
  probe?: typeof probeDataConnection;
  onChange?: () => void;
  processEnv?: Record<string, string | undefined>;
  timeoutMs?: number;
  toolProbe?: ToolProbeContext["probe"];
}

/** Owns an unsaved data draft and evidence for exactly its current connection. */
export class DataSettingsDraft {
  private settings: OhQuantSettings;
  private sample: DataProbeRequest;
  private controller: AbortController | null = null;
  private disposed = false;
  private verifiedConnection: string | null = null;
  private result: DataReadiness | null = null;
  private message = "Choose a market and source, then check a small sample.";

  constructor(settings: OhQuantSettings, private readonly options: DataSettingsOptions = {}) {
    this.settings = structuredClone(settings);
    this.sample = defaultDataProbeRequest(settings);
    this.settings.preferences.defaultMarket = this.sample.market;
  }

  get request(): DataProbeRequest { return { ...this.sample }; }
  get readiness(): DataReadiness | null { return this.result ? structuredClone(this.result) : null; }
  get checking(): boolean { return this.controller !== null; }
  get status(): string { return this.message; }
  get canSave(): boolean { return !this.disposed && !this.checking && this.result?.status === "ready" && this.verifiedConnection === this.connection(); }
  toolProbeContext(): ToolProbeContext {
    return { settings: structuredClone(this.settings), market: this.sample.market, processEnv: this.options.processEnv,
      timeoutMs: this.options.timeoutMs, onChange: this.options.onChange, probe: this.options.toolProbe };
  }
  capabilities(): ToolReadiness[] {
    return inspectToolReadiness(this.settings, { market: this.sample.market,
      data: this.verifiedConnection === this.connection() ? this.result : null }, this.options.processEnv ?? process.env);
  }
  private env(): Record<string, string | undefined> { return { ...(this.options.processEnv ?? process.env), ...this.settings.env }; }
  private connection(): string {
    const env = this.env(), key = dataCredentialKey(this.sample.source), endpoint = ENDPOINT_KEYS[this.sample.source];
    return JSON.stringify([key ? env[key] : null, endpoint ? env[endpoint] : null]);
  }
  credentialLabel(): string {
    const key = dataCredentialKey(this.sample.source);
    return !key ? "No key required" : this.settings.env[key]?.trim() ? "Draft key · hidden" : this.env()[key]?.trim() ? "Environment key · hidden" : "Missing key";
  }
  endpoint(): string {
    const key = ENDPOINT_KEYS[this.sample.source];
    return key ? this.env()[key]?.trim() ?? "" : "";
  }
  setMarket(market: DataMarket): void {
    const sources = dataSourcesForMarket(market);
    if (!sources.length) throw new Error("Choose a supported market.");
    this.changed();
    this.settings.preferences.defaultMarket = market;
    if (!sources.includes(this.sample.source)) this.settings.preferences.source = sources[0]!;
    const defaults = defaultDataProbeRequest(this.settings);
    this.sample = { ...this.sample, market, source: defaults.source, symbol: defaults.symbol };
  }
  setSource(source: DataSource): void {
    if (!dataSourcesForMarket(this.sample.market).includes(source)) throw new Error("Source does not cover this market.");
    this.changed(); this.sample.source = source; this.settings.preferences.source = source;
  }
  setSample(field: "symbol" | "start" | "end", value: string): void { this.changed(); this.sample[field] = value.trim(); }
  setKey(value: string): void {
    const key = dataCredentialKey(this.sample.source);
    if (!key || !value.trim()) return;
    this.changed(); this.settings.env[key] = value.trim();
  }
  removeKey(): void {
    const key = dataCredentialKey(this.sample.source);
    if (key) { this.changed(); delete this.settings.env[key]; }
  }
  setEndpoint(value: string): void {
    const key = ENDPOINT_KEYS[this.sample.source];
    if (!key) return;
    if (value) validateDataEndpoint(value);
    this.changed();
    if (value) this.settings.env[key] = value;
    else delete this.settings.env[key];
  }
  setError(message: string): void { this.message = message; }
  private changed(): void {
    this.cancel(); this.result = null; this.verifiedConnection = null;
    this.message = "Draft changed. Check data before saving.";
  }
  cancel(): void {
    const controller = this.controller;
    this.controller = null;
    if (controller) {
      controller.abort(); this.result = null; this.verifiedConnection = null;
      this.message = "Check cancelled. Saved settings unchanged.";
    }
  }
  dispose(): void { this.disposed = true; this.cancel(); }
  async verify(): Promise<void> {
    if (this.disposed) return;
    this.cancel(); this.result = null; this.verifiedConnection = null;
    const controller = new AbortController(); this.controller = controller;
    const connection = this.connection(), processEnv = { ...(this.options.processEnv ?? process.env) };
    this.message = "Checking data · Esc cancels";
    this.options.onChange?.();
    let abort: (() => void) | undefined;
    try {
      const endpoint = this.endpoint();
      if (endpoint) validateDataEndpoint(endpoint);
      const result = await Promise.race([
        (this.options.probe ?? probeDataConnection)(structuredClone(this.settings), this.request, { signal: controller.signal, processEnv, timeoutMs: this.options.timeoutMs }),
        new Promise<null>(resolve => { abort = () => resolve(null); controller.signal.addEventListener("abort", abort, { once: true }); }),
      ]);
      if (this.disposed || this.controller !== controller || !result) return;
      this.result = structuredClone(result);
      this.verifiedConnection = connection;
      this.message = result.detail;
    } catch {
      if (this.controller === controller) this.message = "Check failed. Check endpoint and credentials, then retry.";
    } finally {
      if (abort) controller.signal.removeEventListener("abort", abort);
      if (this.controller === controller) { this.controller = null; this.options.onChange?.(); }
    }
  }
  prepareSave(): OhQuantSettings {
    if (!this.canSave) throw new Error("Check this draft successfully before saving.");
    return structuredClone(this.settings);
  }
}

export function validateDataEndpoint(value: string): string {
  let url: URL;
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error("Endpoint contains control characters.");
  try { url = new URL(value); } catch { throw new Error("Enter an HTTP(S) endpoint."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("Use an HTTP(S) endpoint without credentials, query or fragment.");
  return value;
}
