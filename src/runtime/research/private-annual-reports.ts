import { readAccountPerformance } from "../../performance/index.ts";
import type { AccountHistoryAdapter, AccountPerformanceRequest } from "../../performance/index.ts";
import { renderAnnualResearch } from "../../artifact/src/annual-renderer.ts";
import { verifyAnnualResearch } from "../../research/annual.ts";
import type { AnnualReportRequest } from "../../types/annual-report.ts";

/** Trusted host path. The HTML contains private account values and is never an Agent result or saved annual artifact. */
export async function renderAuthorizedAnnualReport(
  request: AnnualReportRequest, adapter: AccountHistoryAdapter, accountRequest: AccountPerformanceRequest, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const research = verifyAnnualResearch(request);
  const startAt = Date.parse(`${request.year}-01-01T00:00:00.000Z`);
  const endAt = Date.parse(`${request.valuationCutoff}T23:59:59.999Z`);
  if (accountRequest.startAt !== startAt || accountRequest.endAt !== endAt) {
    throw new Error("Account history must cover the exact UTC annual interval; another account timezone needs an explicit separate contract.");
  }
  const account = await readAccountPerformance(adapter, accountRequest, signal);
  signal.throwIfAborted();
  const html = renderAnnualResearch(research, new Date().toISOString(), {
    accountRef: account.request.accountRef, currency: account.request.currency,
    startAt: account.request.startAt, endAt: account.request.endAt, source: account.source,
    openingEquity: account.openingEquity, closingEquity: account.closingEquity,
    netExternalFlow: account.netExternalFlow, netProfit: account.netProfit,
    feesAlreadyDeducted: account.feesAlreadyDeducted, timeWeightedReturn: account.timeWeightedReturn,
    observedMaxDrawdown: account.observedMaxDrawdown, valuationCount: account.points.length,
  });
  signal.throwIfAborted();
  return { visibility: "private-live-only" as const, accountMethod: account.method, verification: account.verification,
    interval: { startAt, endAt }, html };
}
