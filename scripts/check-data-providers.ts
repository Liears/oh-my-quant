import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pullBarsFromProviders, fetchFromAKShareDetailed, fetchFromAKShareGlobalDetailed, fetchAkshareFundNav } from "../src/source/index.ts";
import type { SourceProviderOptions } from "../src/source/index.ts";
import { createStorageSourceProviderOptions } from "../src/runtime/source-runtime.ts";
import { loadSettings } from "../src/storage/index.ts";
import { normalizeFundNav, normalizeFundSymbol } from "../src/market/fund-nav.ts";
import type { Bar, FundNavDaily, Market } from "../src/types/data.ts";

// Deliberately a fixed historical window, not a claim about current quotes or exchange calendars.
const start = "2025-01-06", end = "2025-01-17", timeoutMs = 45_000;
const { values } = parseArgs({ args: process.argv.slice(2), options: { "public-only": { type: "boolean" }, output: { type: "string" } }, allowPositionals: false });
const publicOnly = Boolean(values["public-only"]);
const outputPath = values.output ? resolve(values.output)
  : resolve(import.meta.dir, "../output", publicOnly ? "data-provider-public-matrix.json" : "data-provider-matrix.json");
if (values.output && existsSync(outputPath)) throw new Error("The requested matrix output already exists.");
const fixtures: Array<{ symbol: string; market: Market; kind: "bars" | "fund-nav" }> = [
  { symbol: "000001.SZ", market: "A", kind: "bars" },
  { symbol: "000300.SH", market: "A", kind: "bars" },
  { symbol: "AAPL", market: "US", kind: "bars" },
  { symbol: "00700.HK", market: "HK", kind: "bars" },
  { symbol: "270042.OF", market: "A", kind: "fund-nav" },
];

// Persist categories only: Python/provider errors may echo URLs or credentials.
function failureCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = /HTTP\s+(\d{3})/i.exec(message)?.[1];
  if (status) return `http-${status}`;
  if (/not configured/i.test(message)) return "missing-credential";
  if (/invalid.*token|token.*(?:invalid|无效)|认证失败|authentication failed/i.test(message)) return "authentication-failed";
  if (/permission|权限|积分不足/i.test(message)) return "permission-denied";
  if (/No module named|not installed|not found|ENOENT/i.test(message)) return "missing-dependency";
  if (/timed?\s*out|timeout/i.test(message)) return "timeout";
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|network|offline|ProxyError/i.test(message)) return "connection-failed";
  if (/identity mismatch/i.test(message)) return "identity-mismatch";
  if (/response truncated/i.test(message)) return "truncated-response";
  if (/pagination invalid/i.test(message)) return "invalid-pagination";
  if (/response invalid/i.test(message)) return "invalid-response";
  return "provider-error";
}

const cancellation = new AbortController();
const cancel = () => cancellation.abort(new Error("Data matrix cancelled"));
process.once("SIGINT", cancel);
const results: Record<string, unknown>[] = [];
try {
  const preferred = publicOnly ? "akshare" : loadSettings().preferences.source;
  const providers: SourceProviderOptions = publicOnly
    ? { fallbackOrder: { A: ["akshare"], US: ["akshare"], HK: ["akshare"] } }
    : createStorageSourceProviderOptions();
  for (const fixture of fixtures) {
    const began = performance.now(), observedAt = new Date().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Data matrix timeout")), timeoutMs);
    const signal = AbortSignal.any([cancellation.signal, controller.signal]);
    const endpoints: Array<{ endpoint: string; status: string; rows?: number; failure?: string }> = [];
    let result: Record<string, unknown>;
    try {
      signal.throwIfAborted();
      let values: Bar[] | FundNavDaily[], dates: string[], source: string, endpoint: string | null = null;
      let attempts: Array<{ source: string; status: string; failure?: string }> = [];
      if (fixture.kind === "fund-nav") {
        const data = await fetchAkshareFundNav(fixture.symbol.slice(0, 6), signal);
        signal.throwIfAborted();
        if (normalizeFundSymbol(data.symbol) !== fixture.symbol) throw new Error("Fund identity mismatch");
        values = normalizeFundNav(fixture.symbol, data.nav).filter(row => row.navDate >= start && row.navDate <= end);
        dates = values.map(row => row.navDate);
        source = "akshare"; endpoint = "fund_open_fund_info_em";
        endpoints.push(...data.attempts.map(attempt => ({ endpoint: attempt.endpoint, status: attempt.status, rows: attempt.rows,
          ...(attempt.error ? { failure: failureCategory(attempt.error) } : {}) })));
      } else {
        const pulled = await pullBarsFromProviders(fixture.symbol, fixture.market, start, end, preferred, {
          ...providers, signal,
          adapters: { akshare: { async fetchBars(request) {
            const data = request.market === "A"
              ? await fetchFromAKShareDetailed(request.symbol, request.start, request.end, { signal: request.signal })
              : await fetchFromAKShareGlobalDetailed(request.symbol, request.market, request.start, request.end, request.signal);
            endpoint = data.endpoint;
            endpoints.push(...data.attempts.map(attempt => ({ endpoint: attempt.endpoint, status: attempt.status, rows: attempt.rows,
              ...(attempt.error ? { failure: failureCategory(attempt.error) } : {}) })));
            return data.bars;
          } } },
        });
        values = pulled.bars; source = pulled.source;
        dates = values.map(row => row.date);
        attempts = pulled.attempts.map(attempt => ({ source: attempt.source, status: attempt.status,
          ...(attempt.error ? { failure: failureCategory(attempt.error) } : {}) }));
        if (source !== "akshare") endpoint = source === "financial-datasets" ? "/prices/" : source === "llmquant-data" ? "/api/equity/historical" : null;
      }
      signal.throwIfAborted();
      const boundaryCoverage = dates[0] === start && dates.at(-1) === end;
      const status = values.length === 0 ? "unavailable" : boundaryCoverage ? "pass" : "partial-window";
      result = { ...fixture, status, source, endpoint, rows: values.length, dates, boundaryCoverage,
        contentHash: values.length ? createHash("sha256").update(JSON.stringify(values)).digest("hex") : null, attempts, endpoints };
    } catch (error) {
      result = { ...fixture, status: cancellation.signal.aborted ? "cancelled" : controller.signal.aborted ? "timeout" : "error",
        failure: failureCategory(error), endpoints };
    } finally { clearTimeout(timer); }
    result = { ...result, requestedStart: start, requestedEnd: end, startedAt: observedAt,
      observedAt: new Date().toISOString(), elapsedMs: Math.round((performance.now() - began) * 1000) / 1000 };
    results.push(result);
    process.stdout.write(JSON.stringify(result) + "\n");
  }
} catch (error) {
  results.push({ status: "configuration-error", failure: failureCategory(error) });
} finally {
  process.off("SIGINT", cancel);
  mkdirSync(dirname(outputPath), { recursive: true });
  const ok = results.length === fixtures.length && results.every(result => result.status === "pass");
  writeFileSync(outputPath,
    JSON.stringify({ version: 1, measuredAt: new Date().toISOString(), bun: Bun.version, timeoutMs, ok,
      scope: publicOnly
        ? "Public AKShare-only fixed historical fixtures; saved data credentials were not loaded. No cache, model, account or order calls."
        : "Configured provider fallback for fixed historical fixtures. No cache, model, account or order calls.",
      limitation: "Boundary coverage does not prove a complete exchange calendar or point-in-time/adjusted data.",
      results }, null, 2) + "\n", values.output ? { flag: "wx" } : undefined);
  if (!ok) process.exitCode = cancellation.signal.aborted ? 130 : 1;
}
