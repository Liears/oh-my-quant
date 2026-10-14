/** Actual US/HK native-free fallback, immutable source cache/replay and compiled CLI. */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fetchBars } from "../src/runtime/data/source-runtime.ts";
import { loadDataset } from "../src/storage/index.ts";
import type { ToolProbeResult } from "../src/types/tool-probe.ts";

const output = process.argv[2] ? resolve(process.argv[2]) : null;
if (!output || existsSync(output)) throw new Error("Supply a new output file path.");
const fixtures = [
  { market: "US", symbol: "AAPL", rows: 9, endpoint: "sina_us_daily_native_free" },
  { market: "HK", symbol: "00700.HK", rows: 10, endpoint: "sina_hk_daily_native_free" },
] as const;
const root = mkdtempSync(join(tmpdir(), "whyj-public-global-fallback-")), previous = process.env.OHQUANT_DIR;
const startedAt = new Date().toISOString(), start = "2025-01-06", end = "2025-01-17";
const signal = AbortSignal.timeout(90_000), stages: Record<string, unknown>[] = [];
let passed = true;
try {
  for (const fixture of fixtures) {
    process.env.OHQUANT_DIR = join(root, fixture.market);
    const options = { providers: { signal, fallbackOrder: { [fixture.market]: ["akshare"] as const } } };
    const began = performance.now();
    const cold = await fetchBars(fixture.symbol, fixture.market, start, end, "akshare", options);
    const coldMs = performance.now() - began, hotBegan = performance.now();
    const hot = await fetchBars(fixture.symbol, fixture.market, start, end, "auto", options);
    const ok = cold.origin === "provider" && cold.source === "akshare" && cold.providerEndpoint === fixture.endpoint
      && cold.adjustment === "unadjusted" && cold.bars.length === fixture.rows
      && cold.bars[0]?.date === start && cold.bars.at(-1)?.date === end
      && !!cold.dataset && cold.dataset.providerEndpoint === fixture.endpoint && cold.dataset.adjustment === "unadjusted"
      && JSON.stringify(loadDataset(cold.dataset)) === JSON.stringify(cold.bars)
      && hot.origin === "cache" && hot.dataset?.revision === cold.dataset.revision && JSON.stringify(hot.bars) === JSON.stringify(cold.bars);
    passed &&= ok;
    stages.push({ stage: "source-cold-hot-replay", ...fixture, pass: ok, coldMs, hotMs: performance.now() - hotBegan,
      actualRows: cold.bars.length, revision: cold.dataset?.revision, adjustment: cold.adjustment,
      actualEndpoint: cold.providerEndpoint, coldOrigin: cold.origin, hotOrigin: hot.origin, sample: cold.bars });
    const cli = Bun.spawn([process.execPath, "run", resolve("dist/index.js"), "--json", "-c",
      `/doctor --tool fetch_bars --market ${fixture.market} --provider akshare --symbol ${fixture.symbol} --start ${start} --end ${end}`],
      { env: { ...process.env, OHQUANT_DIR: join(root, "cli", fixture.market) }, stdout: "pipe", stderr: "pipe", signal });
    const [code, stdout, stderr] = await Promise.all([cli.exited, new Response(cli.stdout).text(), new Response(cli.stderr).text()]);
    const result = JSON.parse(stdout) as { ok: boolean; data: ToolProbeResult };
    const cliPass = code === 0 && stderr === "" && result.ok === true && result.data.status === "ready"
      && result.data.rowCount === fixture.rows && result.data.providerEndpoint === fixture.endpoint
      && result.data.dependency?.javascript?.status === "blocked";
    passed &&= cliPass;
    stages.push({ stage: "compiled-cli", ...fixture, pass: cliPass, exitCode: code, stderrEmpty: stderr === "", result });
  }
} catch (error) { passed = false; stages.push({ stage: "interrupted", pass: false, failure: error instanceof Error ? error.name : "unknown" }); }
finally {
  const files = ["src/source/src/sina-global-history.ts", "src/source/src/sina-history-payload.ts", "src/source/src/vendor/sina-history-decoder.js", "src/source/src/vendor/sina-history-decoder.LICENSE",
    "src/source/src/http.ts", "src/source/src/akshare-global-bars.ts", "src/source/src/source-providers.ts", "src/runtime/data/data-readiness.ts",
    "src/runtime/data/tool-probe.ts", "src/types/data-readiness.ts", "src/types/tool-probe.ts", "dist/index.js", "scripts/check-public-global-fallback.ts"];
  writeFileSync(output, JSON.stringify({ version: 1, startedAt, completedAt: new Date().toISOString(), passed, window: { start, end }, stages,
    scope: "Actual public AAPL and 00700.HK, production source facade/storage/replay and compiled CLI in isolated directories. No model, saved user credentials or account.",
    limitations: "Single current observation of a fixed historical window; returned dates are not an independently verified trading calendar. No total-return, company-action calibration, historical publication-time, other-symbol or future service guarantee.",
    codeFiles: files.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })) }, null, 2) + "\n", { flag: "wx" });
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected public global directory.");
  rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ output, passed, stages: stages.map(item => ({ ...item, sample: undefined })) }));
if (!passed) process.exitCode = 1;
