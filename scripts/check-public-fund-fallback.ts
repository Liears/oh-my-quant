/** Actual public fund -> production source, NAV/DCA tools, replay and compiled CLI. */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fetchBars } from "../src/runtime/data/source-runtime.ts";
import { loadDataset, loadFundNavDataset } from "../src/storage/index.ts";
import { akshareFundNavTool } from "../src/tools/akshare-fund-tools.ts";
import { fundDcaBacktestTool } from "../src/tools/fund-dca-tools.ts";
import type { FundNavDaily } from "../src/types/data.ts";
import type { FundNavDatasetRef } from "../src/types/fund-data.ts";

const output = process.argv[2] ? resolve(process.argv[2]) : null;
if (!output || existsSync(output)) throw new Error("Supply a new output file path.");
const root = mkdtempSync(join(tmpdir(), "whyj-public-fund-fallback-")), previous = process.env.OHQUANT_DIR;
const startedAt = new Date().toISOString(), endpoint = "eastmoney_fund_net_worth";
const symbol = "270042.OF", start = "2025-01-06", end = "2025-01-17";
const signal = AbortSignal.timeout(60_000), stages: Record<string, unknown>[] = [];
let passed = true;
try {
  process.env.OHQUANT_DIR = root;
  const options = { providers: { signal, fallbackOrder: { A: ["akshare"] as const } } };
  const cold = await fetchBars(symbol, "A", start, end, "akshare", options);
  const hot = await fetchBars(symbol, "A", start, end, "auto", options);
  const barsPass = cold.origin === "provider" && cold.providerEndpoint === endpoint && cold.adjustment === "unit-nav"
    && cold.bars.length === 10 && cold.bars[0]?.date === start && cold.bars.at(-1)?.date === end
    && !!cold.dataset && cold.dataset.providerEndpoint === endpoint && JSON.stringify(loadDataset(cold.dataset)) === JSON.stringify(cold.bars)
    && hot.origin === "cache" && hot.dataset?.revision === cold.dataset.revision && JSON.stringify(hot.bars) === JSON.stringify(cold.bars);
  passed &&= barsPass;
  stages.push({ stage: "source-bars-and-hot-replay", pass: barsPass, rows: cold.bars.length, endpoint: cold.providerEndpoint,
    adjustment: cold.adjustment, coldOrigin: cold.origin, hotOrigin: hot.origin, revision: cold.dataset?.revision });
  for (const [stage, result] of [
    ["fund-nav-tool", await akshareFundNavTool.execute("public-nav", { symbol }, signal)],
    ["fund-dca-tool", await fundDcaBacktestTool.execute("public-dca", { symbol, start_date: start, end_date: end, frequency: "weekly", purchase_fee_rate: 0 }, signal)],
  ] as const) {
    const details = result.details as { dataset: FundNavDatasetRef; navCurve: FundNavDaily[]; dcaSummary?: { tradeCount: number } };
    const ref = details.dataset;
    const ok = ref?.endpoint === endpoint && ref.adjustment === "unit-nav-unadjusted" && ref.symbol === symbol
      && JSON.stringify(loadFundNavDataset(ref).nav) === JSON.stringify(details.navCurve)
      && (stage !== "fund-dca-tool" || details.dcaSummary?.tradeCount === 2);
    passed &&= ok;
    stages.push({ stage, pass: ok, endpoint: ref?.endpoint, rows: details.navCurve?.length, revision: ref?.revision,
      adjustment: ref?.adjustment, trades: details.dcaSummary?.tradeCount });
  }
  const cli = Bun.spawn([process.execPath, "run", resolve("dist/index.js"), "--json", "-c",
    "/doctor --tool fetch_bars --market Fund --provider akshare --symbol 270042.OF --start 2025-01-06 --end 2025-01-17"],
    { env: { ...process.env, OHQUANT_DIR: join(root, "cli") }, stdout: "pipe", stderr: "pipe", signal });
  const [code, stdout, stderr] = await Promise.all([cli.exited, new Response(cli.stdout).text(), new Response(cli.stderr).text()]);
  const payload = JSON.parse(stdout) as { ok?: boolean; data?: unknown };
  const cliPass = code === 0 && stderr === "" && payload.ok === true;
  passed &&= cliPass;
  stages.push({ stage: "compiled-cli-fund-data-check", pass: cliPass, exitCode: code, stderrEmpty: stderr === "", result: payload });
} catch (error) {
  passed = false; stages.push({ stage: "interrupted", pass: false, failure: error instanceof Error ? error.name : "unknown" });
} finally {
  const files = ["src/source/src/eastmoney-fund-nav.ts", "src/source/src/http.ts", "src/source/src/akshare.ts", "src/runtime/data/fund-data.ts", "src/runtime/data/data-readiness.ts",
    "src/tools/akshare-fund-tools.ts", "src/tools/shared/source-runner.ts", "src/types/fund-data.ts", "dist/index.js", "scripts/check-public-fund-fallback.ts"];
  writeFileSync(output, JSON.stringify({ version: 1, startedAt, completedAt: new Date().toISOString(), passed, symbol, window: { start, end }, stages,
    scope: "Actual public fund only, isolated storage, production adapters/tools and compiled CLI. No model, saved user credentials, account or purchase-fee request.",
    limitations: "One symbol and fixed window observed now. No proof of historical availability, subscription calendar, total return, other markets or future service stability.",
    codeFiles: files.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })) }, null, 2) + "\n", { flag: "wx" });
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected public fund directory.");
  rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ output, passed, stages }));
if (!passed) process.exitCode = 1;
