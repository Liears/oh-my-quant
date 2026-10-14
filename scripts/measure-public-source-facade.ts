/** Actual public AKShare -> source facade -> immutable storage -> hot cache timing. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { fetchBars } from "../src/runtime/data/source-runtime.ts";
import { loadDataset } from "../src/storage/index.ts";
import type { BarsFetchResult } from "../src/source/index.ts";
import type { Market, PriceAdjustment } from "../src/types/data.ts";

const START = "2025-01-06", END = "2025-01-17";
const FIXTURES: Array<{ symbol: string; market: Market; adjustment: PriceAdjustment }> = [
  { symbol: "000001.SZ", market: "A", adjustment: "forward-adjusted" }, { symbol: "000300.SH", market: "A", adjustment: "index-level" },
  { symbol: "AAPL", market: "US", adjustment: "unadjusted" }, { symbol: "00700.HK", market: "HK", adjustment: "unadjusted" },
  { symbol: "270042.OF", market: "A", adjustment: "unit-nav" },
];
const PUBLIC_ORDER = { A: ["akshare"], US: ["akshare"], HK: ["akshare"] } as const;

type Stage = "cold" | "hot";
interface Observation {
  symbol: string; market: Market; sample: number; stage: Stage; status: "pass" | "partial-window" | "late" | "unavailable" | "invalid-replay" | "error" | "cancelled";
  startedAt: string; elapsedMs: number; origin?: string; source?: string; rows?: number; firstDate?: string; lastDate?: string;
  revision?: string; contentHash?: string; observedAt?: string; providerEndpoint?: string; attempts?: BarsFetchResult["attempts"];
  budgetExhausted?: boolean; failure?: string;
  adjustment?: PriceAdjustment;
}

function percentile(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? Math.round(sorted[Math.ceil(sorted.length * p) - 1]! * 1000) / 1000 : null;
  return { count: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
}

function summarize(items: Observation[]) {
  const passed = items.filter(item => item.status === "pass");
  return { attempts: items.length, passed: passed.length, failed: items.length - passed.length,
    failureRate: items.length ? (items.length - passed.length) / items.length : null,
    allElapsed: percentile(items.map(item => item.elapsedMs)), successfulElapsed: percentile(passed.map(item => item.elapsedMs)) };
}

function category(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed?\s*out|timeout/i.test(message)) return "timeout";
  if (/No module named|not installed|ENOENT/i.test(message)) return "missing-dependency";
  if (/HTTP\s+[1-5]\d{2}/i.test(message)) return "provider-http";
  if (/cancel/i.test(message)) return "cancelled";
  return "facade-error";
}

function inspect(result: BarsFetchResult, fixture: typeof FIXTURES[number], sample: number, stage: Stage,
  startedAt: string, began: number, prior?: BarsFetchResult): Observation {
  const rows = result.bars, ref = result.dataset;
  const base = { symbol: fixture.symbol, market: fixture.market, sample, stage, startedAt,
    elapsedMs: Math.round((performance.now() - began) * 1000) / 1000, origin: result.origin, source: result.source,
    rows: rows.length, firstDate: rows[0]?.date, lastDate: rows.at(-1)?.date, revision: ref?.revision,
    contentHash: ref?.contentHash, observedAt: ref?.snapshotAt, providerEndpoint: result.providerEndpoint, attempts: result.attempts,
    adjustment: ref?.adjustment,
    budgetExhausted: result.budgetExhausted ?? false };
  if (result.budgetExhausted) return { ...base, status: "late" };
  if (!rows.length || !ref) return { ...base, status: "unavailable" };
  if (ref.adjustment !== fixture.adjustment || result.adjustment !== ref.adjustment) return { ...base, status: "invalid-replay" };
  if (rows[0]?.date !== START || rows.at(-1)?.date !== END) return { ...base, status: "partial-window" };
  if ((stage === "cold" && (result.origin !== "provider" || result.source !== "akshare"))
    || (stage === "hot" && (result.origin !== "cache" || ref.revision !== prior?.dataset?.revision
      || JSON.stringify(rows) !== JSON.stringify(prior.bars)))) return { ...base, status: "invalid-replay" };
  try {
    if (JSON.stringify(loadDataset(ref)) !== JSON.stringify(rows)) return { ...base, status: "invalid-replay" };
  } catch { return { ...base, status: "invalid-replay" }; }
  return { ...base, status: "pass" };
}

const { values } = parseArgs({ args: process.argv.slice(2), options: {
  samples: { type: "string" }, "budget-ms": { type: "string" }, output: { type: "string" },
}, allowPositionals: false });
const samples = values.samples === undefined ? 5 : Number(values.samples);
const budgetMs = values["budget-ms"] === undefined ? 45_000 : Number(values["budget-ms"]);
if (!Number.isInteger(samples) || samples < 1 || samples > 30) throw new Error("--samples must be 1–30.");
if (!Number.isInteger(budgetMs) || budgetMs < 1000 || budgetMs > 60_000) throw new Error("--budget-ms must be 1000–60000.");
const output = values.output ? resolve(values.output)
  : resolve(import.meta.dir, "../output/public-source-facade-latency.json");
if (existsSync(output)) throw new Error("Output already exists; choose a new artifact path.");

const root = mkdtempSync(join(tmpdir(), "whyj-public-source-facade-"));
const previous = process.env.OHQUANT_DIR;
const interrupted = new AbortController();
const cancel = () => interrupted.abort(new Error("Public facade measurement cancelled"));
process.once("SIGINT", cancel);
const observations: Observation[] = [];
try {
  measurement: for (const fixture of FIXTURES) for (let sample = 1; sample <= samples; sample++) {
    if (interrupted.signal.aborted) break measurement;
    process.env.OHQUANT_DIR = join(root, fixture.symbol.replace(/[^A-Za-z0-9]/g, "_"), String(sample));
    const options = { providers: { fallbackOrder: PUBLIC_ORDER, budgetMs, signal: interrupted.signal } };
    const startedAt = new Date().toISOString(), began = performance.now();
    let cold: BarsFetchResult;
    try {
      cold = await fetchBars(fixture.symbol, fixture.market, START, END, "akshare", options);
      const receipt = inspect(cold, fixture, sample, "cold", startedAt, began);
      observations.push(receipt); process.stdout.write(JSON.stringify(receipt) + "\n");
      if (receipt.status !== "pass") continue;
    } catch (error) {
      const receipt: Observation = { symbol: fixture.symbol, market: fixture.market, sample, stage: "cold",
        status: interrupted.signal.aborted ? "cancelled" : "error", startedAt,
        elapsedMs: Math.round((performance.now() - began) * 1000) / 1000, failure: category(error) };
      observations.push(receipt); process.stdout.write(JSON.stringify(receipt) + "\n");
      if (interrupted.signal.aborted) break measurement;
      continue;
    }
    const hotAt = new Date().toISOString(), hotBegin = performance.now();
    try {
      const hot = await fetchBars(fixture.symbol, fixture.market, START, END, "auto", options);
      const receipt = inspect(hot, fixture, sample, "hot", hotAt, hotBegin, cold);
      observations.push(receipt); process.stdout.write(JSON.stringify(receipt) + "\n");
    } catch (error) {
      const receipt: Observation = { symbol: fixture.symbol, market: fixture.market, sample, stage: "hot",
        status: interrupted.signal.aborted ? "cancelled" : "error", startedAt: hotAt,
        elapsedMs: Math.round((performance.now() - hotBegin) * 1000) / 1000, failure: category(error) };
      observations.push(receipt); process.stdout.write(JSON.stringify(receipt) + "\n");
      if (interrupted.signal.aborted) break measurement;
    }
  }
  const cold = observations.filter(item => item.stage === "cold"), hot = observations.filter(item => item.stage === "hot");
  const codeFiles = ["src/runtime/data/source-runtime.ts", "src/source/src/sources.ts", "src/source/src/source-providers.ts",
    "src/types/data.ts", "src/market/price-adjustment.ts", "src/source/src/akshare.ts", "src/source/src/akshare-scripts.ts", "src/source/src/eastmoney-fund-nav.ts", "src/source/src/akshare-global-bars.ts",
    "src/source/src/http.ts", "src/source/src/sina-global-history.ts", "src/source/src/sina-history-payload.ts", "src/source/src/sina-a-history.ts", "src/source/src/vendor/sina-history-decoder.js",
    "src/storage/src/bars.ts", "scripts/measure-public-source-facade.ts"];
  const artifact = { version: 1, measuredAt: new Date().toISOString(), bun: Bun.version, platform: process.platform,
    mode: "actual-public-akshare-full-facade", window: { start: START, end: END }, budgetMs, samplesPerFixture: samples,
    expectedColdAttempts: FIXTURES.length * samples, scope: "Production source runtime, public AKShare daily bars and exact-native-block US/HK/fund fallbacks (including unit NAV mapped to OHLC), requested price basis, real cache read/write, immutable DatasetRef replay, then hot-cache request. Actual endpoints are recorded. No model, private account, paid provider or dedicated fund-NAV route.",
    limitations: "A fixed historical response observed now does not prove historical publication time, adjusted prices, complete trading calendar, future upstream availability, paid permissions, terminal flush or a hard synchronous-filesystem deadline. With fewer than 20 samples per market, nearest-rank p95 is the sample maximum.",
    codeFiles: codeFiles.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve(import.meta.dir, "..", path))).digest("hex") })),
    fixtures: FIXTURES, summary: { cold: summarize(cold), hot: summarize(hot),
      byFixture: FIXTURES.map(fixture => ({ ...fixture,
        cold: summarize(cold.filter(item => item.symbol === fixture.symbol)),
        hot: summarize(hot.filter(item => item.symbol === fixture.symbol)) })) }, observations };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify({ output, summary: artifact.summary }) + "\n");
  if (cold.length !== FIXTURES.length * samples || cold.some(item => item.status !== "pass")
    || hot.length !== cold.length || hot.some(item => item.status !== "pass")) process.exitCode = interrupted.signal.aborted ? 130 : 1;
} finally {
  process.off("SIGINT", cancel);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  const absoluteRoot = resolve(root), absoluteTemp = resolve(tmpdir());
  if (!absoluteRoot.startsWith(absoluteTemp + sep)) throw new Error("Unexpected facade measurement directory.");
  rmSync(absoluteRoot, { recursive: true, force: true });
}
