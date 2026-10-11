import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateDateRange } from "../src/market/bars.ts";
import { createStorageSourceProviderOptions, fetchBars } from "../src/runtime/source-runtime.ts";
import { loadDataset, loadSettings } from "../src/storage/index.ts";
import type { Market } from "../src/types/data.ts";

const CASES: readonly { symbol: string; market: Market }[] = [
  { symbol: "000001.SZ", market: "A" },
  { symbol: "AAPL", market: "US" },
  { symbol: "00700.HK", market: "HK" },
];

type Sample = { symbol: string; market: Market; sample: number; elapsedMs: number;
  origin?: string; archiveMatches?: boolean; [key: string]: unknown };

function argumentsFromCli(args: string[]) {
  const values = new Map<string, string>();
  let configured = false;
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (key === "--configured" && !configured) { configured = true; index += 1; continue; }
    const value = args[index + 1];
    if (!key || !["--start", "--end", "--samples", "--output"].includes(key) || !value || value.startsWith("--") || values.has(key))
      throw new Error("Usage: bun run scripts/measure-provider-latency.ts --start YYYY-MM-DD --end YYYY-MM-DD --samples 5 --output NEW.json [--configured]");
    values.set(key, value);
    index += 2;
  }
  const start = values.get("--start"), end = values.get("--end"), output = values.get("--output");
  const samples = Number(values.get("--samples"));
  if (!start || !end || !output || !Number.isInteger(samples) || samples < 1 || samples > 20)
    throw new Error("Start, end, a new output path and 1–20 samples are required.");
  validateDateRange(start, end);
  if (existsSync(output) || !existsSync(dirname(output))) throw new Error("Output must be a new file in an existing directory.");
  return { start, end, output, samples, configured };
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
}

async function main() {
  const { start, end, output, samples: count, configured } = argumentsFromCli(process.argv.slice(2));
  // Capture the user's provider configuration before changing the storage root.
  const settings = configured ? loadSettings() : undefined;
  const providerOptions = settings ? createStorageSourceProviderOptions(settings) : {};
  const root = mkdtempSync(join(tmpdir(), "ohq-provider-latency-"));
  process.env.OHQUANT_DIR = root;
  const startedAt = new Date().toISOString();
  const samples: Sample[] = [];
  for (const { symbol, market } of CASES) {
    for (let sample = 1; sample <= count; sample++) {
      const began = performance.now();
      try {
        // This runtime path wires settings, cache and immutable archive dependencies.
        const result = await fetchBars(symbol, market, start, end, settings?.preferences.source ?? "akshare",
          { providers: { ...providerOptions, budgetMs: 60_000 } });
        const archiveMatches = !!result.dataset && isDeepStrictEqual(loadDataset(result.dataset), result.bars);
        const coldElapsedMs = Math.round(performance.now() - began);
        const warmBegan = performance.now();
        const warm = configured && archiveMatches && result.origin === "provider"
          ? await fetchBars(symbol, market, start, end, "auto", { providers: { ...providerOptions, budgetMs: 60_000 } })
          : undefined;
        const warmElapsedMs = warm ? Math.round(performance.now() - warmBegan) : undefined;
        const warmMatches = warm ? warm.origin === "cache" && warm.dataset?.revision === result.dataset?.revision
          && isDeepStrictEqual(warm.bars, result.bars) : undefined;
        const entry = { symbol, market, sample, elapsedMs: coldElapsedMs,
          source: result.source, origin: result.origin, rowCount: result.bars.length, asOfDate: result.asOfDate,
          providerEndpoint: result.providerEndpoint ?? null,
          attempts: result.attempts.map(attempt => ({ source: attempt.source, status: attempt.status,
            providerEndpoint: attempt.providerEndpoint ?? null })),
          datasetRevision: result.dataset?.revision ?? null, datasetHash: result.dataset?.contentHash ?? null,
          archiveMatches, budgetExhausted: result.budgetExhausted ?? false,
          ...(configured ? { warmElapsedMs: warmElapsedMs ?? null, warmMatches: warmMatches ?? false } : {}) };
        samples.push(entry);
        console.log(`${market} ${symbol} ${sample}/${count}: ${entry.elapsedMs} ms · ${entry.origin} · ${entry.rowCount} rows · archive ${archiveMatches ? "ok" : "missing"}${configured ? ` · warm ${warmMatches ? "ok" : "missing"}` : ""}`);
      } catch (error) {
        const entry = { symbol, market, sample, elapsedMs: Math.round(performance.now() - began),
          status: "error", errorClass: error instanceof Error ? error.name : "unknown" };
        samples.push(entry);
        console.log(`${market} ${symbol} ${sample}/${count}: ${entry.elapsedMs} ms · error (${entry.errorClass})`);
      }
    }
  }
  const stats = Object.fromEntries(CASES.map(({ market }) => {
    const entries = samples.filter(entry => entry.market === market);
    const times = entries.map(entry => entry.elapsedMs);
    return [market, { n: entries.length, p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95),
      providerAndArchiveSuccess: entries.filter(entry => "origin" in entry && entry.origin === "provider" && entry.archiveMatches).length }];
  }));
  const result = { startedAt, completedAt: new Date().toISOString(),
    path: configured ? "runtime/source-runtime.fetchBars, configured preference and credentials, isolated cache and archive writes"
      : "runtime/source-runtime.fetchBars, explicit AkShare with settings-backed cache and archive writes",
    mode: configured ? "configured-fallback" : "explicit-akshare",
    window: { start, end }, tempRootName: basename(root), samples, stats,
    limitations: ["Sequential samples in one process and isolated TEMP root; later samples are warm.",
      "An explicit source requests the provider but may return a marked stale fallback on failure.",
      ...(configured ? ["Configured credentials are used but never emitted; provider attempts expose only source, status and safe endpoint.",
        "A warm cache check proves reuse of this run's saved response, not historical publication timing."] : []),
      "A five-sample p95 is the maximum, not a stable latency distribution. One symbol/window per market cannot prove wider availability or historical completeness."] };
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  console.log(`Saved ${output}`);
  if (samples.some(entry => !("origin" in entry && entry.origin === "provider" && entry.archiveMatches
    && (!configured || entry.warmMatches === true)))) process.exitCode = 2;
}

if (import.meta.main) await main();
