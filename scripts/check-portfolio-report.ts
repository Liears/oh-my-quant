import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { comparisonFixture } from "../src/quant/test/fixtures/portfolio-comparison.ts";
import { runPortfolioComparison, createPortfolioComparisonDeps } from "../src/runtime/research/portfolio-comparison.ts";
import { loadPanelPortfolio, savePanelPortfolio, saveBars } from "../src/storage/index.ts";
import { generateArtifact } from "../src/artifact/src/generator.ts";

if (process.argv.includes("--help")) {
  console.log("bun run scripts/check-portfolio-report.ts [new-output-directory]\nCreates synthetic comparison report.html, share.html and evidence.json. No network/model/accounts. Uses isolated temporary storage and never overwrites output.");
} else {
  const output = resolve(process.argv[2] ?? "output/portfolio-report-synthetic");
  if (existsSync(output)) throw new Error("Choose a new output directory.");
  const prior = process.env.OHQUANT_DIR, root = mkdtempSync(join(tmpdir(), "whyj-report-smoke-"));
  process.env.OHQUANT_DIR = root;
  try {
    const fixture = comparisonFixture(), data = loadPanelPortfolio();
    data.groups = fixture.groups.map(group => ({ id: group.id, name: `SYNTHETIC_PRIVATE_${group.name}`, symbolCodes: [...group.members] }));
    data.symbols = fixture.prices.map(price => ({ code: price.symbol, name: price.symbol, added: "2025-01-01" }));
    savePanelPortfolio(data);
    for (const price of fixture.prices) await saveBars(price.symbol, "financial-datasets", price.points.map(point => ({ date: point.date,
      open: point.price, high: point.price, low: point.price, close: point.price, volume: 1, amount: point.price })), fixture.start, fixture.end);
    const request = { groups: ["core", "growth"] as [string, string], start: fixture.start, end: fixture.end, benchmark: "SPY", baseCurrency: "CNY",
      currencies: { AAPL: "USD", MSFT: "USD", SPY: "USD" }, weighting: "rebalance" as const, missingMembers: "fail" as const };
    const artifact = await runPortfolioComparison(request, undefined, { ...createPortfolioComparisonDeps(), fx: async () => ({ baseCurrency: "CNY",
      source: "frankfurter-v2/ecb", observedAt: "2025-01-03T00:00:00.000Z",
      points: fixture.prices[0]!.points.map((point, index) => ({ date: point.date, currency: "USD", rate: [7, 7.7, 8.4][index]! })) }) });
    const sessionPath = join(root, "synthetic-session.jsonl");
    writeFileSync(sessionPath, [
      { type: "session", version: 3, id: "synthetic-comparison", cwd: root },
      { type: "message", id: "u", parentId: null, message: { role: "user", content: "SYNTHETIC_PRIVATE_ACCOUNT 9876543.21" } },
      { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [{ type: "toolCall", id: "c", name: "compare_portfolios", arguments: {
        group_a: "core", group_b: "growth", start: request.start, end: request.end, benchmark: "SPY", base_currency: "CNY", currencies: request.currencies, weighting: "rebalance" } }] } },
      { type: "message", id: "t", parentId: "a", message: { role: "toolResult", toolCallId: "c", toolName: "compare_portfolios", content: [{ type: "text", text: "Synthetic prices and FX; not actual market performance." }], details: artifact } },
    ].map(value => JSON.stringify(value)).join("\n") + "\n");
    const generated = generateArtifact({ sessionPath, title: "Synthetic comparison · fixture only" });
    if (!generated || generated.provenance.datasets.length !== 3 || generated.provenance.datasets.some(dataset => !dataset.verified)) throw new Error("Comparison evidence verification failed.");
    const embedded = generated.html.match(/<script type="application\/json" id="share-document">([\s\S]*?)<\/script>/)?.[1];
    const share: string = embedded ? JSON.parse(embedded) : "";
    if (!share.includes("data-research-comparison") || /SYNTHETIC_PRIVATE|9876543\.21|<script|<iframe/.test(share)) throw new Error("Public projection failed.");
    const actual = [...artifact.result.groups, artifact.result.benchmark].map(curve => curve.nav.at(-1)!.value), expected = [1.875, 1.2, 1.452];
    if (actual.some((value, index) => Math.abs(value - expected[index]!) > 1e-12)) throw new Error("Independent fixture returns mismatch.");
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "report.html"), generated.html, { flag: "wx" });
    // The banner labels the preview fixture; production sharing uses the exact embedded bytes.
    writeFileSync(join(output, "share.html"), share.replace("<header>", "<header><p>SYNTHETIC FIXTURE · Prices and FX are artificial; provider labels exercise archive contracts only.</p>"), { flag: "wx" });
    writeFileSync(join(output, "evidence.json"), JSON.stringify({ status: "pass", observedAt: new Date().toISOString(), fixture: "synthetic; no provider calls", expectedFinalNav: expected,
      actualFinalNav: actual, verifiedDatasets: generated.provenance.datasets.length, publicProjectionChecked: true,
      scope: "Generated HTML remains self-contained. Temporary comparison/price archives and transcript removed; no live provider or model-task acceptance claimed." }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: "pass", output, actualFinalNav: actual }));
  } finally {
    if (prior === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = prior;
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected report fixture directory");
    rmSync(root, { recursive: true, force: true });
  }
}
