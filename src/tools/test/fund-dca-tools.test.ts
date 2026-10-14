import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import * as source from "../../source/index.ts";
import * as python from "../../source/src/akshare-python.ts";
import { fundDcaBacktestTool } from "../fund-dca-tools.ts";
import { akshareFundNavTool } from "../akshare-fund-tools.ts";
import { loadFundNavDataset } from "../../storage/index.ts";
import { fundHistory, fundNav } from "../../storage/test/fixtures/fund-nav.ts";
import type { FundNavDatasetRef } from "../../types/fund-data.ts";
import type { DcaBacktestResult } from "../../quant/fund-dca.ts";
import { resolveResearchFund, verifyFundResearch } from "../../research/fund.ts";
import { runDcaBacktest } from "../../quant/fund-dca.ts";
import { fundDcaInterpretationNotes } from "../../quant/fund-dca-notes.ts";

let root: string, previous: string | undefined;
const restores: Array<() => void> = [];
beforeEach(() => { previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "ohq-dca-tools-")); process.env.OHQUANT_DIR = root; });
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected DCA fixture directory");
  rmSync(root, { recursive: true, force: true });
});

it("shares current interpretation with verified historical DCA results while preserving the saved numerical payload", async () => {
  const nav = spyOn(source, "fetchAkshareFundNav").mockResolvedValue(fundHistory());
  restores.push(() => nav.mockRestore());
  const args = { symbol: "270042.OF", start_date: "2026-02-01", end_date: "2026-03-01", invest_amount: 100, purchase_fee_rate: 0 };
  const result = await fundDcaBacktestTool.execute("explanation", args);
  const saved = result.details as Record<string, unknown>, bytes = JSON.stringify(saved);
  const analysis = verifyFundResearch(args, saved, 0, [resolveResearchFund(saved.dataset)]);
  const expected = fundDcaInterpretationNotes(runDcaBacktest(fundNav(), { startDate: args.start_date, endDate: args.end_date, investAmount: 100 }));
  for (const note of expected) {
    expect(result.content.some(part => part.type === "text" && part.text.includes(note))).toBe(true);
    expect(analysis.assumptions).toContain(note);
  }
  expect(saved).not.toHaveProperty("interpretationNotes"); // Old records need no rewrite or new field.
  expect(JSON.stringify(saved)).toBe(bytes);
  expect(analysis.metrics.find(metric => metric.label === "Principal return")?.value).toBeCloseTo(0.25, 12);
  expect(analysis.metrics.find(metric => metric.label === "Time-weighted return")?.value).toBeCloseTo(0.5, 12);
  expect(analysis.metrics.find(metric => metric.label === "Purchases")).toEqual({ label: "Purchases", value: 2, unit: "number" });
});

it("runs the real DCA tool, archives public inputs and keeps published fee units unambiguous", async () => {
  const nav = spyOn(source, "fetchAkshareFundNav").mockResolvedValue(fundHistory());
  const purchase = spyOn(source, "fetchAkshareFundPurchase");
  restores.push(() => nav.mockRestore(), () => purchase.mockRestore());
  for (const feePercent of [0.03, 0.13, 6]) {
    purchase.mockResolvedValue(fundHistory([], { "手续费": feePercent, secret: "PRIVATE_FEE" }));
    const result = await fundDcaBacktestTool.execute("dca", { symbol: "270042.OF", start_date: "2026-01-01" });
    const details = result.details as { dataset: FundNavDatasetRef; feeBasis: string; dcaPlan: DcaBacktestResult["plan"]; dcaSummary: DcaBacktestResult["summary"] };
    expect(nav.mock.calls.at(-1)![0]).toBe("270042");
    expect(details.feeBasis).toBe("current-published-assumption");
    expect(details.dcaPlan.purchaseFeeRate).toBe(feePercent / 100);
    expect(loadFundNavDataset(details.dataset).fee!.rate).toBe(feePercent / 100);
    expect(details.dcaSummary.maxDrawdown).toBeLessThanOrEqual(-0.5);
    expect(JSON.stringify(loadFundNavDataset(details.dataset))).not.toContain("PRIVATE_FEE");
  }
});

it("uses explicit zero without a fee request, and marks failed fee observation as a zero-fee assumption", async () => {
  const nav = spyOn(source, "fetchAkshareFundNav").mockResolvedValue(fundHistory());
  const purchase = spyOn(source, "fetchAkshareFundPurchase").mockRejectedValue(new Error("Fee provider unavailable"));
  restores.push(() => nav.mockRestore(), () => purchase.mockRestore());
  const explicit = await fundDcaBacktestTool.execute("explicit", { symbol: "270042", purchase_fee_rate: 0 });
  expect(purchase).not.toHaveBeenCalled();
  expect(explicit.details).toMatchObject({ feeBasis: "explicit-assumption", dcaPlan: { purchaseFeeRate: 0 }, dcaSummary: { maxDrawdown: -0.5 } });
  const automatic = await fundDcaBacktestTool.execute("auto", { symbol: "270042" });
  expect(automatic.details).toMatchObject({ feeBasis: "unavailable-assumed-zero", dcaPlan: { purchaseFeeRate: 0 } });
  const ref = (automatic.details as { dataset: FundNavDatasetRef }).dataset;
  expect(loadFundNavDataset(ref).fee!.rate).toBeNull();
});

it("rejects invalid plans before fetching and never revives old NAV after a live empty response", async () => {
  const nav = spyOn(source, "fetchAkshareFundNav").mockResolvedValue(fundHistory());
  restores.push(() => nav.mockRestore());
  for (const args of [{ symbol: "270042.SH" }, { symbol: "270042", start_date: "invalid" }, { symbol: "270042", invest_amount: -1 }, { symbol: "270042", invest_day: 0 }]) {
    await expect(fundDcaBacktestTool.execute("invalid", { ...args, purchase_fee_rate: 0 })).rejects.toThrow();
  }
  expect(nav).not.toHaveBeenCalled();
  await fundDcaBacktestTool.execute("first", { symbol: "270042", purchase_fee_rate: 0 });
  nav.mockResolvedValue(fundHistory([]));
  const empty = await fundDcaBacktestTool.execute("empty", { symbol: "270042", purchase_fee_rate: 0 });
  expect(empty.details).not.toHaveProperty("dcaSummary");
  expect(empty.details).not.toHaveProperty("dataset");
  const revisions = readdirSync(join(root, "data", "akshare", "270042.OF", "nav-revisions"));
  expect(revisions.filter(file => file.endsWith(".json"))).toHaveLength(1);
  expect(revisions.filter(file => file.endsWith(".commit"))).toHaveLength(1);
});

it("rejects mismatched NAV identity and treats another fund's fee as unavailable", async () => {
  const nav = spyOn(source, "fetchAkshareFundNav").mockResolvedValue({ ...fundHistory(), symbol: "000001" });
  const purchase = spyOn(source, "fetchAkshareFundPurchase");
  restores.push(() => nav.mockRestore(), () => purchase.mockRestore());
  await expect(fundDcaBacktestTool.execute("wrong-nav", { symbol: "270042", purchase_fee_rate: 0 })).rejects.toThrow("Fund NAV identity mismatch");
  expect(readdirSync(root)).toEqual([]);
  nav.mockResolvedValue(fundHistory());
  for (const data of [{ ...fundHistory([], { "手续费": 2 }), symbol: "000001" }, fundHistory([], { "基金代码": "000001", "手续费": 2 })]) {
    purchase.mockResolvedValue(data);
    const result = await fundDcaBacktestTool.execute("wrong-fee", { symbol: "270042" });
    expect(result.details).toMatchObject({ feeBasis: "unavailable-assumed-zero", purchase: {}, dcaPlan: { purchaseFeeRate: 0 } });
    expect(loadFundNavDataset((result.details as { dataset: FundNavDatasetRef }).dataset).fee!.rate).toBeNull();
  }
});

it("propagates cancellation through DCA preparation and rejects late observations before archiving", async () => {
  const controller = new AbortController();
  const nav = spyOn(source, "fetchAkshareFundNav").mockImplementation(async (_symbol, signal) => {
    expect(signal).toBeDefined();
    controller.abort(new Error("cancel DCA"));
    expect(signal!.aborted).toBe(true);
    return fundHistory();
  });
  restores.push(() => nav.mockRestore());
  await expect(fundDcaBacktestTool.execute("cancel", { symbol: "270042", purchase_fee_rate: 0 }, controller.signal)).rejects.toThrow("cancel DCA");
  expect(readdirSync(root)).toEqual([]);
  await expect(fundDcaBacktestTool.execute("cancel-before", { symbol: "270042", purchase_fee_rate: 0 }, controller.signal)).rejects.toThrow();
  expect(nav).toHaveBeenCalledTimes(1);
});

it("archives the actual NAV fallback endpoint, filters invalid rows and stops fallback on cancellation", async () => {
  const nav = spyOn(source, "fetchAkshareFundNav").mockResolvedValue(fundHistory(fundNav().map(row => ({ ...row, unitNav: -1 }))));
  const rows = spyOn(source, "fetchAkshareRows").mockResolvedValue({ endpoint: "fund_etf_fund_info_em", params: {}, fetchedAt: "", rowCount: 2,
    rows: [{ "净值日期": "2026-01-01", "单位净值": 1 }, { "净值日期": "2026-02-01", "单位净值": 0.5 }] });
  restores.push(() => nav.mockRestore(), () => rows.mockRestore());
  const result = await akshareFundNavTool.execute("nav", { symbol: "270042.OF" });
  const ref = (result.details as { dataset: FundNavDatasetRef }).dataset;
  expect(ref.endpoint).toBe("fund_etf_fund_info_em");
  expect(loadFundNavDataset(ref).nav.map(row => row.unitNav)).toEqual([1, 0.5]);
  rows.mockClear();
  const controller = new AbortController();
  nav.mockImplementation(async () => { controller.abort(new Error("stop fallback")); return fundHistory([]); });
  await expect(akshareFundNavTool.execute("cancel-nav", { symbol: "270042" }, controller.signal)).rejects.toThrow("stop fallback");
  expect(rows).not.toHaveBeenCalled();
});

it("passes the actual abort signal to the Python NAV, purchase and generic fund adapters", async () => {
  const controller = new AbortController();
  const run = spyOn(python, "runPython").mockImplementation(async (_script, args, options) => {
    expect(options?.signal).toBe(controller.signal);
    return { stdout: JSON.stringify({ symbol: "270042", nav: [], fetched_at: "2026-04-01T08:00:00", endpoint: args?.[0] === "fund_etf_fund_info_em" ? args[0] : undefined, rows: [] }), stderr: "" };
  });
  restores.push(() => run.mockRestore());
  await source.fetchAkshareFundNav("270042", controller.signal);
  await source.fetchAkshareFundPurchase("270042", controller.signal);
  await source.fetchAkshareRows("fund_etf_fund_info_em", { fund: "270042" }, controller.signal);
  expect(run).toHaveBeenCalledTimes(3);
});
