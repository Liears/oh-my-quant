/** Actual public fund NAV -> production DCA data runtime -> immutable observation timing. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { loadFundDcaData } from "../data/fund-data.ts";
import { loadFundNavDataset } from "../../storage/index.ts";
import { FUND_NAV_ENDPOINTS } from "../../types/fund-data.ts";

const SYMBOL = "270042.OF", START = "2025-01-06", END = "2025-01-17";
type Status = "pass" | "partial-window" | "invalid-replay" | "unavailable" | "timeout" | "cancelled" | "error";
interface Observation {
  sample: number; startedAt: string; elapsedMs: number; status: Status;
  rows?: number; windowRows?: number; firstDate?: string; lastDate?: string;
  endpoint?: string; revision?: string; contentHash?: string; observedAt?: string;
  attemptEndpoints?: string[]; failure?: string;
}

function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? Math.round(sorted[Math.ceil(sorted.length * p) - 1]! * 1000) / 1000 : null;
  return { count: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
}
function failureKind(error: unknown, interrupted: boolean): Status {
  if (interrupted) return "cancelled";
  const message = error instanceof Error ? error.message : String(error);
  if (/timed?\s*out|timeout|aborted/i.test(message)) return "timeout";
  return "error";
}

const { values } = parseArgs({ args: process.argv.slice(2), options: {
  samples: { type: "string" }, "budget-ms": { type: "string" }, output: { type: "string" },
}, allowPositionals: false });
const samples = values.samples === undefined ? 20 : Number(values.samples);
const budgetMs = values["budget-ms"] === undefined ? 45_000 : Number(values["budget-ms"]);
if (!Number.isInteger(samples) || samples < 1 || samples > 30) throw new Error("--samples must be 1–30.");
if (!Number.isInteger(budgetMs) || budgetMs < 1000 || budgetMs > 60_000) throw new Error("--budget-ms must be 1000–60000.");
const output = values.output ? resolve(values.output) : resolve(import.meta.dir, "../../../output/public-fund-runtime-latency.json");
if (existsSync(output)) throw new Error("Output already exists; choose a new artifact path.");

const root = mkdtempSync(join(tmpdir(), "whyj-public-fund-runtime-"));
const previous = process.env.OHQUANT_DIR;
const interrupted = new AbortController();
const cancel = () => interrupted.abort(new Error("Fund runtime measurement cancelled"));
process.once("SIGINT", cancel);
const observations: Observation[] = [];
try {
  for (let sample = 1; sample <= samples; sample++) {
    if (interrupted.signal.aborted) break;
    process.env.OHQUANT_DIR = join(root, String(sample));
    const signal = AbortSignal.any([interrupted.signal, AbortSignal.timeout(budgetMs)]);
    const startedAt = new Date().toISOString(), began = performance.now();
    let receipt: Observation;
    try {
      const data = await loadFundDcaData(SYMBOL, false, signal);
      const ref = data.dataset, dates = data.nav.map(row => row.navDate);
      const windowDates = dates.filter(date => date >= START && date <= END);
      const base = { sample, startedAt, elapsedMs: Math.round((performance.now() - began) * 1000) / 1000,
        rows: data.nav.length, windowRows: windowDates.length, firstDate: windowDates[0], lastDate: windowDates.at(-1),
        endpoint: ref?.endpoint, revision: ref?.revision, contentHash: ref?.contentHash, observedAt: ref?.snapshotAt,
        attemptEndpoints: data.attempts.map(item => item.endpoint) };
      if (!ref || !data.nav.length) receipt = { ...base, status: "unavailable" };
      else if (windowDates[0] !== START || windowDates.at(-1) !== END) receipt = { ...base, status: "partial-window" };
      else {
        try {
          const stored = loadFundNavDataset(ref);
          receipt = { ...base, status: ref.kind === "fund-nav" && ref.symbol === SYMBOL
            && FUND_NAV_ENDPOINTS.includes(ref.endpoint) && data.attempts.some(item => item.status === "ok" && item.endpoint.split(":")[0] === ref.endpoint)
            && JSON.stringify(stored.nav) === JSON.stringify(data.nav)
            ? "pass" : "invalid-replay" };
        } catch { receipt = { ...base, status: "invalid-replay" }; }
      }
    } catch (error) {
      receipt = { sample, startedAt, elapsedMs: Math.round((performance.now() - began) * 1000) / 1000,
        status: failureKind(error, interrupted.signal.aborted), failure: error instanceof Error ? error.name : "unknown" };
    }
    observations.push(receipt); process.stdout.write(JSON.stringify(receipt) + "\n");
    if (interrupted.signal.aborted) break;
  }
  const passed = observations.filter(item => item.status === "pass");
  const codeFiles = ["src/runtime/data/fund-data.ts", "src/source/src/akshare.ts", "src/source/src/akshare-scripts.ts", "src/source/src/eastmoney-fund-nav.ts", "src/source/src/http.ts", "src/types/fund-data.ts", "src/storage/src/fund-nav.ts",
    "src/runtime/dev/measure-public-fund-runtime.ts"];
  const artifact = { version: 1, measuredAt: new Date().toISOString(), bun: Bun.version, platform: process.platform,
    mode: "actual-public-fund-nav-production-runtime", symbol: SYMBOL, requestedWindow: { start: START, end: END },
    samples, budgetMs, observeFee: false, scope: "Every attempt pulls public NAV through the production AKShare adapter and its exact-native-block literal fallback, normalizes identity, archives a fresh immutable FundNavDatasetRef and reloads it. Actual endpoints are recorded. No account, model or purchase-fee request.",
    limitations: "The upstream NAV endpoint returns its full history rather than a server-side fixed window; only window coverage is checked. The supplied AbortSignal bounds async work, not synchronous archive writes. No hot cache, historical publication proof, fee history, paid permission or terminal flush is measured.",
    codeFiles: codeFiles.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve(import.meta.dir, "../../..", path))).digest("hex") })),
    summary: { attempts: observations.length, passed: passed.length, failed: observations.length - passed.length,
      failureRate: observations.length ? (observations.length - passed.length) / observations.length : null,
      allElapsed: percentiles(observations.map(item => item.elapsedMs)), successfulElapsed: percentiles(passed.map(item => item.elapsedMs)) }, observations };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify({ output, summary: artifact.summary }) + "\n");
  if (observations.length !== samples || observations.some(item => item.status !== "pass")) process.exitCode = interrupted.signal.aborted ? 130 : 1;
} finally {
  process.off("SIGINT", cancel);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  const absoluteRoot = resolve(root), absoluteTemp = resolve(tmpdir());
  if (!absoluteRoot.startsWith(absoluteTemp + sep)) throw new Error("Unexpected fund measurement directory.");
  rmSync(absoluteRoot, { recursive: true, force: true });
}
