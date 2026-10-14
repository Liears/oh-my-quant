import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import * as python from "../../source/src/akshare-python.ts";
import { FUND_LITERAL, BLOCKED_FUND_ATTEMPTS } from "../../source/tests/fixtures/eastmoney-fund.ts";
import { fundDcaBacktestTool } from "../../tools/fund-dca-tools.ts";
import { akshareFundNavTool } from "../../tools/akshare-fund-tools.ts";
import { loadFundNavDataset } from "../../storage/index.ts";
import type { FundNavDatasetRef } from "../../types/fund-data.ts";
import type { FundNavDaily } from "../../types/data.ts";

let root: string, previous: string | undefined;
const originalFetch = globalThis.fetch, restores: Array<() => void> = [];
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-literal-nav-")); process.env.OHQUANT_DIR = root;
  const run = spyOn(python, "runPython").mockResolvedValue({ stdout: JSON.stringify({ symbol: "270042", nav: [], attempts: BLOCKED_FUND_ATTEMPTS }), stderr: "" });
  restores.push(() => run.mockRestore());
  globalThis.fetch = (async () => new Response(FUND_LITERAL)) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch; for (const restore of restores.splice(0)) restore();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected literal NAV test directory");
  rmSync(root, { recursive: true, force: true });
});

it("archives and replays the actual fallback endpoint through production NAV and DCA tools", async () => {
  for (const result of [await akshareFundNavTool.execute("nav", { symbol: "270042.OF" }),
    await fundDcaBacktestTool.execute("dca", { symbol: "270042.OF", start_date: "2025-01-06", end_date: "2025-01-07", frequency: "weekly", purchase_fee_rate: 0 })]) {
    const details = result.details as { dataset: FundNavDatasetRef; navCurve: FundNavDaily[] };
    expect(details.dataset).toMatchObject({ endpoint: "eastmoney_fund_net_worth", symbol: "270042.OF", adjustment: "unit-nav-unadjusted" });
    expect(loadFundNavDataset(details.dataset).nav).toEqual(details.navCurve);
    if ((result.details as Record<string, unknown>).sourceAttempts) expect(result.details).toMatchObject({ endpoint: "eastmoney_fund_net_worth",
      sourceAttempts: [{ endpoint: "eastmoney_fund_net_worth", rows: 2, status: "ok" }] });
  }
  expect(readdirSync(root)).toEqual(["data"]);
});

it("never archives a wrong-identity fallback or silently returns an old revision", async () => {
  await fundDcaBacktestTool.execute("good", { symbol: "270042", frequency: "weekly", purchase_fee_rate: 0 });
  const dir = join(root, "data", "akshare", "270042.OF", "nav-revisions"), before = readdirSync(dir);
  globalThis.fetch = (async () => new Response(FUND_LITERAL.replace('"270042"', '"999999"'))) as unknown as typeof fetch;
  await expect(fundDcaBacktestTool.execute("bad", { symbol: "270042", purchase_fee_rate: 0 })).rejects.toThrow("identity mismatch");
  expect(readdirSync(dir)).toEqual(before);
});
