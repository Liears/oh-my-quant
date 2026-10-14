/** Actual A-share/index fallback through source, archive/cache and compiled CLI. */
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
  { symbol: "000001.SZ", endpoint: "sina_a_daily_qfq_native_free", adjustment: "forward-adjusted" },
  { symbol: "000300.SH", endpoint: "sina_a_index_daily_native_free", adjustment: "index-level" },
] as const;
const root = mkdtempSync(join(tmpdir(), "whyj-public-a-fallback-")), previous = process.env.OHQUANT_DIR;
const startedAt = new Date().toISOString(), start = "2025-01-06", end = "2025-01-17";
const signal = AbortSignal.timeout(150_000), stages: Record<string, unknown>[] = [];
let passed = true;
try {
  for (const fixture of fixtures) {
    process.env.OHQUANT_DIR = join(root, fixture.symbol);
    const options = { providers: { signal, fallbackOrder: { A: ["akshare"] as const } } };
    const began = performance.now();
    const cold = await fetchBars(fixture.symbol, "A", start, end, "akshare", options);
    const coldMs = performance.now() - began, hotBegan = performance.now();
    const hot = await fetchBars(fixture.symbol, "A", start, end, "auto", options);
    const ok = cold.origin === "provider" && cold.source === "akshare" && cold.providerEndpoint === fixture.endpoint
      && cold.adjustment === fixture.adjustment && cold.bars.length === 10
      && cold.bars[0]?.date === start && cold.bars.at(-1)?.date === end
      && !!cold.dataset && cold.dataset.providerEndpoint === fixture.endpoint && cold.dataset.adjustment === fixture.adjustment
      && JSON.stringify(loadDataset(cold.dataset)) === JSON.stringify(cold.bars)
      && hot.origin === "cache" && hot.dataset?.revision === cold.dataset.revision && JSON.stringify(hot.bars) === JSON.stringify(cold.bars);
    passed &&= ok;
    stages.push({ stage: "source-default-cold-hot-replay", ...fixture, pass: ok, coldMs, hotMs: performance.now() - hotBegan,
      actualRows: cold.bars.length, revision: cold.dataset?.revision, actualAdjustment: cold.adjustment,
      actualEndpoint: cold.providerEndpoint, coldOrigin: cold.origin, hotOrigin: hot.origin, sample: cold.bars });
    const cli = Bun.spawn([process.execPath, "run", resolve("dist/index.js"), "--json", "-c",
      `/doctor --tool fetch_bars --market A --provider akshare --symbol ${fixture.symbol} --start ${start} --end ${end}`],
      { env: { ...process.env, OHQUANT_DIR: join(root, "cli", fixture.symbol) }, stdout: "pipe", stderr: "pipe", signal });
    const [code, stdout, stderr] = await Promise.all([cli.exited, new Response(cli.stdout).text(), new Response(cli.stderr).text()]);
    const result = JSON.parse(stdout) as { ok: boolean; data: ToolProbeResult };
    const cliPass = code === 0 && stderr === "" && result.ok === true && result.data.status === "ready"
      && result.data.rowCount === 10 && result.data.providerEndpoint === fixture.endpoint;
    passed &&= cliPass;
    stages.push({ stage: "compiled-cli-default", ...fixture, pass: cliPass, exitCode: code, stderrEmpty: stderr === "", result });
  }
  process.env.OHQUANT_DIR = join(root, "sina-explicit");
  const began = performance.now();
  const explicit = await fetchBars("000001.SZ", "A", start, end, "akshare", {
    providers: { signal, fallbackOrder: { A: ["akshare"] }, akshare: { sourcePriority: "sina" } },
  });
  const ok = explicit.origin === "provider" && explicit.bars.length === 10 && explicit.providerEndpoint === fixtures[0].endpoint
    && explicit.adjustment === "forward-adjusted" && !!explicit.dataset && JSON.stringify(loadDataset(explicit.dataset)) === JSON.stringify(explicit.bars);
  passed &&= ok;
  stages.push({ stage: "source-explicit-sina-native-block", pass: ok, rows: explicit.bars.length, endpoint: explicit.providerEndpoint,
    adjustment: explicit.adjustment, revision: explicit.dataset?.revision, elapsedMs: performance.now() - began });
} catch (error) { passed = false; stages.push({ stage: "interrupted", pass: false, failure: error instanceof Error ? error.name : "unknown" }); }
finally {
  const files = ["src/source/src/sina-a-history.ts", "src/source/src/sina-history-payload.ts", "src/source/src/vendor/sina-history-decoder.js",
    "src/source/src/http.ts", "src/source/src/akshare.ts", "src/source/src/akshare-scripts.ts", "src/source/src/akshare-python.ts",
    "src/source/src/source-providers.ts", "src/runtime/data/data-readiness.ts", "src/runtime/data/tool-probe.ts", "dist/index.js", "scripts/check-public-a-fallback.ts"];
  writeFileSync(output, JSON.stringify({ version: 1, startedAt, completedAt: new Date().toISOString(), passed, window: { start, end }, stages,
    scope: "Actual public A share and known index, production facade/storage/replay, compiled CLI and explicit Sina source-priority in isolated directories. No model, saved credentials or account.",
    limitations: "Single observation of a fixed historical window. Provider qfq factors are not independently calibrated corporate actions or historical publication evidence. Dates do not certify the calendar; no rounding or unit conversion is inferred.",
    codeFiles: files.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })) }, null, 2) + "\n", { flag: "wx" });
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected public A directory.");
  rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ output, passed, stages: stages.map(item => ({ ...item, sample: undefined })) }));
if (!passed) process.exitCode = 1;
