import { checkAkshareDependency, pullBarsFromProviders } from "../source/index.ts";
import type { SourceProviderOptions } from "../source/index.ts";
import { inferMarket, normalizeSymbol } from "../market/symbols.ts";
import { validateDateRange } from "../market/bars.ts";
import type { DataSource, OhQuantSettings } from "../types/config.ts";
import type { DataMarket, DataProbeRequest, DataReadiness, DataReadinessStatus, PythonReadiness } from "../types/data-readiness.ts";

export const DATA_MARKETS: readonly DataMarket[] = ["A", "US", "HK", "Fund"];
export function dataSourcesForMarket(market: DataMarket): DataSource[] {
  return market === "A" || market === "Fund" ? ["akshare", "tushare"]
    : market === "US" ? ["llmquant-data", "financial-datasets", "akshare"] : market === "HK" ? ["llmquant-data", "akshare"] : [];
}
export function dataCredentialKey(source: DataSource): string | null {
  return source === "tushare" ? "WHYJ_QUANT_TUSHARE_TOKEN" : source === "llmquant-data" ? "WHYJ_QUANT_LLMQUANT_API_KEY"
    : source === "financial-datasets" ? "WHYJ_QUANT_FINANCIAL_DATASETS_KEY" : null;
}

/** Existing global source settings may cover another market; always expose the actual sample. */
export function defaultDataProbeRequest(settings: OhQuantSettings, now = new Date()): DataProbeRequest {
  const source = settings.preferences.source;
  const preferred = settings.preferences.defaultMarket;
  const market: DataMarket = DATA_MARKETS.includes(preferred as DataMarket) && dataSourcesForMarket(preferred as DataMarket).includes(source)
    ? preferred as DataMarket : source === "akshare" || source === "tushare" ? "A" : "US";
  return { source, market, symbol: market === "A" ? "000001.SZ" : market === "US" ? "AAPL" : market === "HK" ? "00700.HK" : "270042.OF",
    start: new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

export interface DataProbeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  processEnv?: Record<string, string | undefined>;
  adapters?: SourceProviderOptions["adapters"];
  checkDependency?: (options: { signal: AbortSignal; timeoutMs: number }) => Promise<PythonReadiness>;
}

/** Probes one selected source with an immutable credential snapshot; no fallback or cache. */
export async function probeDataConnection(settings: OhQuantSettings, request: DataProbeRequest, options: DataProbeOptions = {}): Promise<DataReadiness> {
  const started = performance.now();
  const input = { ...request };
  const env = { ...(options.processEnv ?? process.env), ...settings.env };
  const key = dataCredentialKey(input.source);
  const credential = key ? env[key]?.trim() : undefined;
  const credentialSource: DataReadiness["credentialSource"] = !key ? "not-required" : !credential ? "missing" : settings.env[key]?.trim() ? "config" : "env";
  let dependency: PythonReadiness | undefined, rowCount = 0, asOfDate: string | null = null;
  const result = (status: DataReadinessStatus): DataReadiness => ({ ...input, status,
    detail: status === "ready" ? `${input.source} · ${input.symbol} · ${rowCount} valid rows · as-of ${asOfDate}`
      : `${input.source} · ${status}${status === "missing-credential" ? ` · ${key}` : ""}`,
    action: status === "ready" ? "Sample verified only; other symbols, windows and tool permissions remain unverified."
      : status === "missing-python" ? "Install Python 3, then retry this data check."
        : status === "missing-package" ? "Install akshare in the Python environment used by WhyJ, then retry."
          : status === "missing-credential" || status === "auth-failed" ? `Open /config and check ${key ?? "data credentials"}.`
            : status === "permission-denied" ? "Check the provider subscription and permission for this endpoint."
              : status === "unsupported" ? "Choose a source compatible with the selected market."
                : status === "invalid-input" ? "Check the full symbol, market and YYYY-MM-DD date window."
                  : status === "empty" ? "No valid observations in this window; check the symbol, dates and provider coverage."
                    : status === "cancelled" ? "Check cancelled; saved settings are unchanged."
                      : "Check connectivity and the data endpoint, then retry.",
    credentialSource, rowCount, asOfDate, observedAt: new Date().toISOString(), durationMs: performance.now() - started,
    capability: input.market === "Fund" ? "unit-nav" : "daily-bars", ...(dependency ? { dependency } : {}),
  });
  if (options.signal?.aborted) return result("cancelled");
  if (!dataSourcesForMarket(input.market).includes(input.source)) return result("unsupported");
  try {
    validateDateRange(input.start, input.end);
    input.symbol = normalizeSymbol(input.market === "Fund" && /^\d{6}$/.test(input.symbol) ? `${input.symbol}.OF` : input.symbol);
    if (input.market === "Fund" ? !/\.OF$/.test(input.symbol) : /\.OF$/.test(input.symbol) || inferMarket(input.symbol) !== input.market) return result("invalid-input");
  } catch { return result("invalid-input"); }
  if (key && !credential) return result("missing-credential");
  const controller = new AbortController(), timeoutMs = Math.max(1, options.timeoutMs ?? 30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new Error("Data probe timed out")), timeoutMs);
  let onAbort: (() => void) | undefined;
  try {
    const probe = async (): Promise<DataReadiness> => {
      if (input.source === "akshare") {
        dependency = await (options.checkDependency ?? checkAkshareDependency)({ signal, timeoutMs });
        signal.throwIfAborted();
        if (dependency.status !== "ready") return result(dependency.status);
      }
      const market = input.market === "Fund" ? "A" : input.market;
      const pulled = await pullBarsFromProviders(input.symbol, market, input.start, input.end, input.source, {
        signal, adapters: options.adapters, fallbackOrder: { [market]: [input.source] },
        tushare: { token: input.source === "tushare" ? credential : undefined, baseUrl: env.TUSHARE_BASE_URL, env },
        llmquant: { apiKey: input.source === "llmquant-data" ? credential : undefined, baseUrl: env.LLMQUANT_BASE_URL, env },
        financialDatasets: { apiKey: input.source === "financial-datasets" ? credential : undefined, baseUrl: env.FINANCIAL_DATASETS_BASE_URL, env },
      });
      signal.throwIfAborted();
      rowCount = pulled.bars.length; asOfDate = pulled.bars.at(-1)?.date ?? null;
      if (rowCount) return result("ready");
      return result(pulled.attempts.some(attempt => attempt.status === "error")
        ? classifyDataFailure(pulled.attempts.find(attempt => attempt.status === "error")?.error ?? "") : "empty");
    };
    return await Promise.race([probe(), new Promise<DataReadiness>(resolve => {
      onAbort = () => resolve(result(options.signal?.aborted ? "cancelled" : "timeout"));
      if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
    })]);
  } catch (error) {
    return result(options.signal?.aborted ? "cancelled" : signal.aborted ? "timeout" : classifyDataFailure(error instanceof Error ? error.message : ""));
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function classifyDataFailure(message: string): DataReadinessStatus {
  if (/HTTP\s+401\b|invalid.*token|token.*(?:invalid|无效)|认证失败|authentication failed/i.test(message)) return "auth-failed";
  if (/HTTP\s+(?:402|403)\b|permission|权限|积分不足/i.test(message)) return "permission-denied";
  if (/timed?\s*out|timeout/i.test(message)) return "timeout";
  return "unavailable";
}
