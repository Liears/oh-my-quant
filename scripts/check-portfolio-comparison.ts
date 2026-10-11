import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import { runPortfolioComparison, restorePortfolioComparison } from "../src/runtime/portfolio-comparison.ts";
import { loadPanelPortfolio, savePanelPortfolio } from "../src/storage/index.ts";
import { fetchComparisonFx } from "../src/source/index.ts";

if (process.argv.includes("--help")) {
  console.log("bun run scripts/check-portfolio-comparison.ts [output.json]\nLive public-data smoke: fixed fund groups, A-share index benchmark and independent USD/HKD FX probe. Uses an isolated temporary workspace; no model, accounts or orders. Output is created exclusively, never overwritten.");
} else {
  const output = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const prior = process.env.OHQUANT_DIR, root = mkdtempSync(join(tmpdir(), "whyj-live-comparison-"));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error("Comparison smoke timed out")), 60_000);
  const interrupt = () => controller.abort(new Error("Comparison smoke cancelled"));
  process.on("SIGINT", interrupt);
  process.env.OHQUANT_DIR = root;
  try {
    const data = loadPanelPortfolio();
    data.groups = [{ id: "fixture-a", name: "Public fund fixture A", symbolCodes: ["270042.OF"] },
      { id: "fixture-b", name: "Public fund fixture B", symbolCodes: ["110022.OF"] }];
    data.symbols = data.groups.flatMap(group => group.symbolCodes.map(code => ({ code, name: code, added: "2025-01-01", instrument: "fund" as const })));
    savePanelPortfolio(data);
    const before = readFileSync(join(root, "panel-portfolio.json"), "utf8"), started = performance.now();
    const comparison = await runPortfolioComparison({ groups: ["fixture-a", "fixture-b"], start: "2025-01-06", end: "2025-01-17",
      benchmark: "000300.SH", baseCurrency: "CNY", currencies: { "270042.OF": "CNY", "110022.OF": "CNY", "000300.SH": "CNY" },
      weighting: "buy-and-hold", missingMembers: "fail" }, controller.signal);
    restorePortfolioComparison(comparison.id);
    if (readFileSync(join(root, "panel-portfolio.json"), "utf8") !== before) throw new Error("Comparison changed observation preferences.");
    const fx = await fetchComparisonFx("CNY", ["USD", "HKD"], "2025-01-06", "2025-01-10", { signal: controller.signal });
    controller.signal.throwIfAborted();
    const result = { status: "pass", observedAt: new Date().toISOString(), durationMs: performance.now() - started, bun: Bun.version,
      scope: "Fixed public research fixture. Quote currencies explicitly assumed CNY. Independent FX probe; no live cross-currency portfolio or model evaluation. Temporary dataset files removed after calculation; complete comparison inputs retained here.",
      preferencesUnchanged: true, recordedInputsRecomputed: true, comparison, fx };
    if (output) writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: result.status, observedAt: result.observedAt, durationMs: result.durationMs,
      commonDates: comparison.result.dates.length, fxRows: fx.points.length, output: output ?? null }));
  } catch (error) {
    console.error(JSON.stringify({ status: "fail", message: error instanceof Error ? error.message : "Comparison smoke failed" }));
    process.exitCode = 1;
  } finally {
    clearTimeout(timer); process.off("SIGINT", interrupt);
    if (prior === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = prior;
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected comparison smoke directory");
    rmSync(root, { recursive: true, force: true });
  }
}
