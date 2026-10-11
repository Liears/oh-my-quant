import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseHTML } from "linkedom";
import { accountHistoryFixture } from "../account-performance/test/fixture.ts";
import type { AccountHistory, AccountHistoryAdapter } from "../account-performance/index.ts";
import { annualComparisonFixture } from "../research/test/annual-fixture.ts";
import { loadAnnualReport } from "../storage/index.ts";
import { annualReportTool } from "../tools/annual-tools.ts";
import { listAnnualReports } from "./annual-reports.ts";
import { renderAuthorizedAnnualReport } from "./private-annual-reports.ts";

let root: string, previous: string | undefined;
let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-private-annual-"));
  process.env.OHQUANT_DIR = root;
  network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); network.mockRestore();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected private annual fixture");
  rmSync(root, { recursive: true, force: true });
});

function annualHistory(): AccountHistory {
  const history = accountHistoryFixture();
  const endAt = Date.parse("2025-12-31T23:59:59.999Z");
  history.request.endAt = endAt;
  history.valuations.at(-1)!.at = endAt;
  history.source.observedAt = endAt + 1000;
  return history;
}

function adapter(history: AccountHistory) {
  const readHistory = mock(async () => structuredClone(history));
  const port: AccountHistoryAdapter = { id: history.source.adapterId, accountRef: history.request.accountRef, readHistory };
  return { port, readHistory };
}

test("explicit private annual report joins verified research and complete account TWR without storing account values", async () => {
  const comparison = (await annualComparisonFixture()).save();
  const history = annualHistory();
  history.request.accountRef = "private-account<script>bad()</script>";
  history.source.reference = "private-statement<script>bad()</script>";
  const { port, readHistory } = adapter(history);
  const result = await renderAuthorizedAnnualReport({ comparisonId: comparison.id, year: 2025, valuationCutoff: "2025-12-31" },
    port, history.request, AbortSignal.timeout(5000));
  const { document } = parseHTML(result.html);
  expect(readHistory).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ visibility: "private-live-only", accountMethod: "flow-valuations-twr-v1" });
  expect(document.querySelector("[data-account-performance]")?.textContent).toContain("−1.00%");
  expect(document.querySelector("[data-account-performance]")?.textContent).toContain("−11.00");
  expect(document.querySelector("[data-research-comparison]")?.textContent).toContain("20.00%");
  expect(result.html).toContain("private-account&lt;script&gt;bad()&lt;/script&gt;");
  expect(result.html).toContain("private-statement&lt;script&gt;bad()&lt;/script&gt;");
  expect(document.querySelectorAll("script,iframe,img,link")).toHaveLength(0);
  expect(result.html).not.toContain("真实账户业绩未接入");
  expect(listAnnualReports().items).toHaveLength(0);
  expect(existsSync(join(root, "reports", "annual"))).toBe(false);
});

test("wrong annual boundary and incomplete account history fail closed without publishing", async () => {
  const comparison = (await annualComparisonFixture()).save();
  const request = { comparisonId: comparison.id, year: 2025, valuationCutoff: "2025-12-31" };
  const history = annualHistory(), { port, readHistory } = adapter(history);
  await expect(renderAuthorizedAnnualReport(request, port, { ...history.request, endAt: history.request.endAt - 86_400_000 },
    AbortSignal.timeout(5000))).rejects.toThrow("UTC annual interval");
  expect(readHistory).not.toHaveBeenCalled();
  history.coverage.externalFlows = "incomplete";
  await expect(renderAuthorizedAnnualReport(request, adapter(history).port, history.request,
    AbortSignal.timeout(5000))).rejects.toThrow("Complete external-flow");
  expect(listAnnualReports().items).toHaveLength(0);
  expect(existsSync(join(root, "reports", "annual"))).toBe(false);
});

test("a private account render never enters the default Agent annual result or saved research HTML", async () => {
  const comparison = (await annualComparisonFixture()).save(), history = annualHistory();
  history.request.accountRef = "PRIVATE_ACCOUNT_SENTINEL_7361";
  const request = { comparisonId: comparison.id, year: 2025, valuationCutoff: "2025-12-31" };
  const privateResult = await renderAuthorizedAnnualReport(request, adapter(history).port, history.request, AbortSignal.timeout(5000));
  expect(privateResult.html).toContain(history.request.accountRef);
  const ordinary = await annualReportTool.execute("public-research", { comparison_id: comparison.id, year: 2025, valuation_cutoff: "2025-12-31" });
  const reportId = (ordinary.details as { id: string }).id;
  expect(JSON.stringify(ordinary)).not.toContain(history.request.accountRef);
  expect(loadAnnualReport(reportId).html).not.toContain(history.request.accountRef);
  expect(loadAnnualReport(reportId).html).toContain("真实账户业绩未接入");
});

test("cancellation before the account read does not call the adapter or create a report", async () => {
  const comparison = (await annualComparisonFixture()).save(), history = annualHistory();
  const { port, readHistory } = adapter(history);
  await expect(renderAuthorizedAnnualReport({ comparisonId: comparison.id, year: 2025, valuationCutoff: "2025-12-31" },
    port, history.request, AbortSignal.abort(new Error("private annual cancelled")))).rejects.toThrow("private annual cancelled");
  expect(readHistory).not.toHaveBeenCalled();
  expect(listAnnualReports().items).toHaveLength(0);
});
