import { checkAkshareDependency, fetchAkshareRows, fetchAkshareIndexRows, fetchSinaAIndexSpotQuotes, searchTushareSymbols,
  AKSHARE_PUBLIC_INDEX_ENDPOINTS, DEFAULT_TUSHARE_BASE_URL, fetchComparisonFx, fetchNews, normalizeNewsScope, type AksharePublicFundEndpoint, type AksharePublicIndexEndpoint } from "../../source/index.ts";
import { listBuiltinToolCapabilities } from "../../tools/registry.ts";
import { toolProbeChoices, validToolProbeParameters } from "./tool-probe-catalog.ts";
import { isDailyDate, validateDateRange } from "../../market/bars.ts";
import { isSafeProviderEndpoint } from "../../market/provider-endpoint.ts";
import { akshareIndexTemporalRangeError } from "./akshare-index-semantics.ts";
import { AKSHARE_RUNTIME_BLOCKED_ACTION, akshareJavaScriptFailure, classifyDataFailure, defaultDataProbeRequest, probeDataConnection, type DataProbeOptions } from "./data-readiness.ts";
import type { OhQuantSettings, DataSource } from "../../types/config.ts";
import type { DataMarket, PythonReadiness, DataReadinessStatus } from "../../types/data-readiness.ts";
import type { ToolProbeRequest, ToolProbeResult } from "../../types/tool-probe.ts";

export { toolProbeChoices, type ToolProbeChoice } from "./tool-probe-catalog.ts";

export function defaultToolProbeRequest(settings: OhQuantSettings, tool: string, market: DataMarket): ToolProbeRequest | null {
  const choices = toolProbeChoices(tool, market);
  const defaults = tool === "research_news" ? choices.filter(item => item.endpoint === "news-search" || item.endpoint === "ticker-news" || item.endpoint === "stock_news_em") : choices;
  const choice = defaults.find(item => item.provider === settings.preferences.source) ?? defaults[0];
  if (!choice) return null;
  const sample = defaultDataProbeRequest({ ...settings, preferences: { ...settings.preferences, defaultMarket: market,
    source: choice.provider === "sina" || choice.provider === "frankfurter" || choice.provider === "yahoo" ? "akshare" : choice.provider as DataSource } });
  const newsEndpoint = choice.endpoint === "news-search" || choice.endpoint === "ticker-news" || choice.endpoint === "stock_news_em";
  const params: ToolProbeRequest["params"] = choice.endpoint === "daily-series" || newsEndpoint ? { symbol: newsEndpoint ? market === "A" ? "000001.SZ" : market === "HK" ? "00700.HK" : "AAPL" : sample.symbol, start: sample.start, end: sample.end }
    : choice.provider === "frankfurter" ? { base: "CNY", quote: "USD", start: sample.start, end: sample.end }
      : choice.provider === "tushare" ? { keyword: "平安银行" } : choice.provider === "sina" ? { symbol: "000300" } : {};
  return { tool, provider: choice.provider, endpoint: choice.endpoint, market, params };
}

export interface ToolProbeOptions extends Pick<DataProbeOptions, "signal" | "timeoutMs" | "processEnv" | "checkDependency"> {
  adapters?: {
    fundRows?: typeof fetchAkshareRows;
    indexRows?: typeof fetchAkshareIndexRows;
    search?: typeof searchTushareSymbols;
    sina?: typeof fetchSinaAIndexSpotQuotes;
    daily?: typeof probeDataConnection;
    fx?: typeof fetchComparisonFx;
    news?: typeof fetchNews;
  };
}

/** Executes one source adapter with a fixed credential snapshot. No cache, storage or fallback. */
export async function probeToolEndpoint(settings: OhQuantSettings, request: ToolProbeRequest, options: ToolProbeOptions = {}): Promise<ToolProbeResult> {
  const started = performance.now(), input = structuredClone(request), snapshot = structuredClone(settings);
  const processEnv = { ...(options.processEnv ?? process.env) }, env = { ...processEnv, ...snapshot.env };
  const choice = toolProbeChoices(input.tool, input.market).find(item => item.provider === input.provider && item.endpoint === input.endpoint);
  const dailyWindow = ["daily-series", "news-search", "ticker-news", "stock_news_em", "ecb-fx"].includes(input.endpoint);
  let dependency: PythonReadiness | undefined, providerEndpoint: string | undefined, rows = 0, inputError: string | undefined;
  const result = (status: DataReadinessStatus): ToolProbeResult => ({ ...input, status, rowCount: rows, scope: "endpoint-response",
    observedAt: new Date().toISOString(), durationMs: performance.now() - started, ...(dependency ? { dependency } : {}),
    ...(status === "ready" && providerEndpoint ? { providerEndpoint } : {}),
    detail: `${input.provider} / ${input.endpoint} · ${status} · ${rows} nonempty rows${status === "ready" && providerEndpoint ? ` · source ${providerEndpoint}` : ""}`,
    action: status === "ready" ? "Only this endpoint and these parameters returned data. Tool computations, other endpoints and freshness remain unchecked."
      : status === "invalid-input" ? inputError ?? "Check the endpoint parameter schema; required strings must be nonempty."
        : status === "unsupported" ? "Choose a public data route declared by this tool for the selected market."
          : status === "blocked-runtime" ? AKSHARE_RUNTIME_BLOCKED_ACTION
            : status === "missing-package" && dependency?.javascript?.status === "missing-package" ? "Install py-mini-racer in WhyJ's Python environment, then retry."
              : status === "unavailable" && dependency?.javascript?.status === "unavailable" ? "AKShare's MiniRacer runtime could not initialize. Check WhyJ's Python environment."
          : status === "missing-python" || status === "missing-package" ? "Install Python 3 and akshare in WhyJ's Python environment."
            : status === "auth-failed" || status === "missing-credential" ? "Check this provider's credential in Data connection."
              : status === "permission-denied" ? "Check permission or subscription for this exact endpoint."
                : status === "empty" ? "No nonempty response rows; check parameters and coverage. Access is not verified."
                  : status === "cancelled" ? "Check cancelled; saved settings are unchanged." : "Check connectivity and retry this endpoint.",
  });
  if (options.signal?.aborted) return result("cancelled");
  if (!choice) return result("unsupported");
  if (!validToolProbeParameters(choice.parameters, input.params)) {
    if (input.params && typeof input.params === "object" && !Array.isArray(input.params)) {
      inputError = dailyWindow && typeof input.params.start === "string" && typeof input.params.end === "string"
        && (!isDailyDate(input.params.start) || !isDailyDate(input.params.end))
        ? "Dates must be valid YYYY-MM-DD values." : akshareIndexTemporalRangeError(input.endpoint, input.params);
    }
    input.params = {};
    return result("invalid-input");
  }
  inputError = akshareIndexTemporalRangeError(input.endpoint, input.params);
  if (inputError) { input.params = {}; return result("invalid-input"); }
  if (dailyWindow) {
    try { validateDateRange(String(input.params.start), String(input.params.end)); }
    catch (error) {
      inputError = error instanceof Error ? error.message : "Invalid date window.";
      input.params = {};
      return result("invalid-input");
    }
  }
  const route = listBuiltinToolCapabilities().find(tool => tool.name === input.tool)!.requirements.routes.find(route => route.provider === input.provider && route.markets.includes(input.market))!;
  if (route.credential && !env[route.credential]?.trim()) return result("missing-credential");
  const controller = new AbortController(), timeoutMs = Math.max(1, options.timeoutMs ?? 30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let abort: (() => void) | undefined;
  try {
    const run = async (): Promise<ToolProbeResult> => {
      if (input.endpoint === "daily-series") {
        const daily = await (options.adapters?.daily ?? probeDataConnection)(snapshot, { source: input.provider as DataSource, market: input.market,
          symbol: String(input.params.symbol), start: String(input.params.start), end: String(input.params.end) }, { signal, timeoutMs, processEnv, checkDependency: options.checkDependency });
        signal.throwIfAborted(); dependency = daily.dependency; rows = daily.rowCount;
        providerEndpoint = isSafeProviderEndpoint(daily.providerEndpoint) ? daily.providerEndpoint : undefined;
        return result(daily.status);
      }
      if (route.dependencies.length) {
        const javascript = input.endpoint === "fund_open_fund_info_em";
        dependency = await (options.checkDependency ?? checkAkshareDependency)({ signal, timeoutMs, javascript });
        signal.throwIfAborted();
        if (dependency.status !== "ready") return result(dependency.status);
        const runtimeFailure = javascript ? akshareJavaScriptFailure(dependency) : null;
        if (runtimeFailure) return result(runtimeFailure);
      }
      let values: unknown[];
      if (input.endpoint === "news-search" || input.endpoint === "ticker-news" || input.endpoint === "stock_news_em") {
        if (input.market === "Fund") return result("unsupported");
        try { normalizeNewsScope({ symbol: String(input.params.symbol), market: input.market, start: String(input.params.start), end: String(input.params.end) }); }
        catch { return result("invalid-input"); }
        const news = await (options.adapters?.news ?? fetchNews)({ symbol: String(input.params.symbol), market: input.market,
          start: String(input.params.start), end: String(input.params.end), provider: input.provider === "yahoo" ? "yahoo" : "eastmoney" }, { signal, endpoint: input.endpoint });
        signal.throwIfAborted();
        if (news.status === "unavailable") return result("unavailable");
        values = news.articles;
      } else if (input.provider === "frankfurter") {
        const base = String(input.params.base), quote = String(input.params.quote);
        if (base === quote) return result("invalid-input");
        values = (await (options.adapters?.fx ?? fetchComparisonFx)(base, [quote], String(input.params.start), String(input.params.end), { signal, timeoutMs })).points;
      } else if (input.provider === "tushare") {
        const found = await (options.adapters?.search ?? searchTushareSymbols)(String(input.params.keyword), {
          token: env.WHYJ_QUANT_TUSHARE_TOKEN, baseUrl: env.TUSHARE_BASE_URL?.trim() || DEFAULT_TUSHARE_BASE_URL, env, signal });
        values = found.filter(row => /^\d{6}\.(?:SH|SZ|BJ)$/.test(row.code) && row.name.trim());
      } else if (input.provider === "sina") {
        values = (await (options.adapters?.sina ?? fetchSinaAIndexSpotQuotes)([String(input.params.symbol)], signal))
          .filter(row => Number.isFinite(row.price) && row.price! > 0);
      } else if ((AKSHARE_PUBLIC_INDEX_ENDPOINTS as readonly string[]).includes(input.endpoint)) {
        values = (await (options.adapters?.indexRows ?? fetchAkshareIndexRows)(input.endpoint as AksharePublicIndexEndpoint, input.params, signal)).rows;
      } else {
        values = (await (options.adapters?.fundRows ?? fetchAkshareRows)(input.endpoint as AksharePublicFundEndpoint, input.params, signal)).rows;
      }
      signal.throwIfAborted();
      rows = values.filter(row => row !== null && typeof row === "object" && !Array.isArray(row)
        && Object.values(row).some(value => typeof value === "string" ? value.trim().length > 0 : typeof value === "number" && Number.isFinite(value))).length;
      return result(rows ? "ready" : "empty");
    };
    return await Promise.race([run(), new Promise<ToolProbeResult>(resolve => {
      abort = () => resolve(result(options.signal?.aborted ? "cancelled" : "timeout"));
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    })]);
  } catch (error) {
    return result(options.signal?.aborted ? "cancelled" : signal.aborted ? "timeout" : classifyDataFailure(error instanceof Error ? error.message : ""));
  } finally {
    clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort);
  }
}

export function formatToolProbe(result: ToolProbeResult): string {
  return [`Tool endpoint check: ${result.tool}`, `${result.market} · ${result.provider} / ${result.endpoint}`,
    `Parameters: ${JSON.stringify(result.params)}`, result.detail, `Observed: ${result.observedAt}`, result.action].join("\n");
}
