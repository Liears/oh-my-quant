import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import * as source from "../../source/index.ts";
import { archiveFundNav, artifactReference, loadArtifact, saveArtifact } from "../../storage/index.ts";
import { fundNav, fundHistory, NAV_OBSERVED_AT } from "../../storage/test/fixtures/fund-nav.ts";
import { fundDcaBacktestTool } from "../../tools/fund-dca-tools.ts";
import { buildResearchReport } from "../../research/input.ts";
import { loadReportSession } from "../src/report-input.ts";
import { generateArtifact } from "../src/generator.ts";
import { renderShareReport } from "../src/research-renderer.ts";
import type { FundNavDatasetRef } from "../../types/fund-data.ts";

let root: string, previous: string | undefined;
const restores: Array<() => void> = [];
const PRIVATE = "PRIVATE_FUND_RESEARCH_772ed";
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "ohq-report-fund-")); process.env.OHQUANT_DIR = root;
  const nav = spyOn(source, "fetchAkshareFundNav").mockResolvedValue(fundHistory());
  const purchase = spyOn(source, "fetchAkshareFundPurchase").mockResolvedValue(fundHistory([], { "手续费": 0.03, secret: PRIVATE }));
  restores.push(() => nav.mockRestore(), () => purchase.mockRestore());
});
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid fund report fixture");
  rmSync(root, { recursive: true, force: true });
});

function transcript(args: Record<string, unknown>, details: unknown, name = "fund_dca_backtest"): string {
  const path = join(root, "private-session.jsonl");
  writeFileSync(path, [
    { type: "session", version: 3, id: PRIVATE, cwd: root },
    { type: "message", id: "u", parentId: null, message: { role: "user", content: PRIVATE } },
    { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [{ type: "toolCall", id: "fund-call", name, arguments: { ...args, secret: PRIVATE } }] } },
    { type: "message", id: "t", parentId: "a", message: { role: "toolResult", toolCallId: "fund-call", toolName: name, content: [{ type: "text", text: PRIVATE }], details } },
  ].map(value => JSON.stringify(value)).join("\n") + "\n");
  return path;
}
function share(html: string): string { return JSON.parse(html.match(/<script type="application\/json" id="share-document">([\s\S]*?)<\/script>/)![1]!); }

it("binds actual DCA trades, fees and cash-flow-adjusted results while sharing no amounts", async () => {
  const args = { symbol: "270042.OF", start_date: "2026-01-01", invest_amount: 9876543.21, purchase_fee_rate: 0 };
  const result = await fundDcaBacktestTool.execute("fund-call", args);
  const path = transcript(args, result.details), input = loadReportSession(path)!;
  const research = buildResearchReport(input);
  expect(research.analyses.map(value => value.kind)).toEqual(["fund-dca"]);
  expect(research.exclusions).toEqual({ unavailableInputs: 0, unverifiedResults: 0, unsupportedResults: 0 });
  expect(research.analyses[0]!.curve!.values).toEqual([1, 0.5, 0.75]);
  const generated = generateArtifact({ sessionPath: path, leafId: "t", title: PRIVATE })!;
  expect(generated.provenance.datasets).toHaveLength(1);
  expect(generated.provenance.datasets[0]!.verified).toBe(true);
  const html = share(generated.html);
  expect(html).toContain("-50.00%");
  expect(html).toContain("+8.33%");
  expect(html).toContain("270042.OF");
  expect(html).toContain("TWR index");
  expect(html).not.toMatch(/PRIVATE_FUND|9876543\.21|cumulativeShares|totalPrincipal|<script|<iframe|src=/);
  expect(html).not.toContain(root);
  expect(generated.html).toContain(PRIVATE);
});

it("verifies published fee assumptions, includes first-purchase cost and rejects edited inputs or ledger", async () => {
  const args = { symbol: "270042", start_date: "2026-01-01", invest_amount: 1000 };
  const result = await fundDcaBacktestTool.execute("fund-call", args);
  const path = transcript(args, result.details);
  const first = buildResearchReport(loadReportSession(path)!);
  expect(first.analyses[0]!.curve!.values[0]).toBeCloseTo(1 / 1.0003, 12);
  expect(renderShareReport(first)).toContain("current-published-assumption");
  for (const field of ["amount", "start", "fee", "summary", "trades", "curve", "fee-basis", "nav", "latest"] as const) {
    const changedArgs: Record<string, unknown> = { ...args }, details = structuredClone(result.details) as Record<string, unknown>;
    if (field === "amount") changedArgs.invest_amount = 2000;
    if (field === "start") changedArgs.start_date = "2026-02-01";
    if (field === "fee") (details.dcaPlan as Record<string, unknown>).purchaseFeeRate = 0;
    if (field === "summary") (details.dcaSummary as Record<string, unknown>).maxDrawdown = 0;
    if (field === "trades") (details.dcaTrades as Array<Record<string, unknown>>)[0]!.shares = 123;
    if (field === "curve") (details.dcaAccountCurve as Array<Record<string, unknown>>)[1]!.performanceIndex = 2;
    if (field === "fee-basis") details.feeBasis = "explicit-assumption";
    if (field === "nav") (details.navCurve as Array<Record<string, unknown>>)[0]!.unitNav = 10;
    if (field === "latest") (details.latestNav as Record<string, unknown>).navDate = "2026-04-01";
    const report = buildResearchReport(loadReportSession(transcript(changedArgs, details))!);
    expect(report.analyses).toHaveLength(0);
    expect(report.exclusions.unverifiedResults).toBe(1);
  }
  const legacy = { ...(result.details as object), methodVersion: 1 };
  expect(buildResearchReport(loadReportSession(transcript(args, legacy))!).exclusions.unsupportedResults).toBe(1);
});

it("keeps archived NAV, fee and saved public bytes fixed after corrections or loss of source evidence", async () => {
  const args = { symbol: "270042", purchase_fee_rate: 0 };
  const result = await fundDcaBacktestTool.execute("fund-call", args);
  const path = transcript(args, result.details), generated = generateArtifact({ sessionPath: path })!;
  const before = share(generated.html), ref = (result.details as { dataset: FundNavDatasetRef }).dataset;
  const saved = saveArtifact(generated.sessionId, generated.html, { title: generated.title, messageCount: generated.messageCount, provenance: generated.provenance });
  await archiveFundNav("270042", fundNav().map(row => ({ ...row, unitNav: row.unitNav + 5 })), "fund_open_fund_info_em", NAV_OBSERVED_AT);
  expect(share(generateArtifact({ sessionPath: path })!.html)).toBe(before);
  rmSync(join(root, "data", "akshare", "270042.OF", "nav-revisions", `${ref.revision}.json`));
  const unavailable = generateArtifact({ sessionPath: path })!;
  expect(unavailable.provenance.datasets[0]!.verified).toBe(false);
  expect(unavailable.html).toContain("Fund NAV revision unavailable");
  expect(unavailable.html).not.toContain('id="share-document"');
  writeFileSync(path, "source damaged");
  expect(share(loadArtifact(artifactReference(saved))!)).toBe(before);
});

it("renders NAV as NAV and excludes hostile reference metadata and unknown public fields", async () => {
  const ref = (await archiveFundNav("270042", fundNav(), "fund_open_fund_info_em", NAV_OBSERVED_AT))!;
  const path = transcript({ symbol: "270042" }, { dataset: { ...ref, secret: PRIVATE } }, "akshare_fund_nav");
  const generated = generateArtifact({ sessionPath: path })!, html = share(generated.html);
  expect(html).toContain("Unit NAV");
  expect(html).not.toContain("<th>Open</th>");
  expect(html).not.toContain(PRIVATE);
  expect(html).not.toContain("RECOMPUTED · MATCHED SAVED RESULT");
  for (const change of [{ symbol: "270042.SH" }, { endpoint: `${PRIVATE}</script>` }, { revision: "../account" }, { snapshotAt: PRIVATE }]) {
    const failed = buildResearchReport(loadReportSession(transcript({}, { dataset: { ...ref, ...change } }, "akshare_fund_nav"))!);
    expect(failed.datasets).toHaveLength(0);
    expect(renderShareReport(failed)).toBeUndefined();
  }
  expect(readFileSync(path, "utf8")).toContain(PRIVATE);
});
