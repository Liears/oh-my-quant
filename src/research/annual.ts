import { isDailyDate } from "../market/bars.ts";
import { loadPortfolioComparison } from "../storage/index.ts";
import type { AnnualReportRequest } from "../types/annual-report.ts";
import { ANNUAL_PERSPECTIVES_V1 } from "./annual-perspectives.ts";
import { verifyArchivedComparison } from "./archived-comparison.ts";
import { verifyResearchDecision } from "./decisions.ts";

/** Resolve real archives, not reconstructed tool events or model-authored numbers. */
export function verifyAnnualResearch(request: AnnualReportRequest, asOf = new Date().toISOString().slice(0, 10)) {
  if (!Number.isInteger(request.year) || request.year < 1900 || request.year > 9999
    || !isDailyDate(request.valuationCutoff) || !isDailyDate(asOf)
    || !request.valuationCutoff.startsWith(`${request.year}-`) || request.valuationCutoff > asOf) throw new Error("Annual cutoff must be a valid date in the requested year and not in the future.");
  const start = `${request.year}-01-01`, source = loadPortfolioComparison(request.comparisonId), { input } = source.result;
  if (input.start !== start || input.end !== request.valuationCutoff) throw new Error(`Comparison window must be ${start} through ${request.valuationCutoff}; create a matching comparison first.`);
  const evidence = verifyArchivedComparison(source);
  if (request.decisionSelection !== undefined && (request.decisionSelection !== "all-recorded-at-generation" || !request.decisionIds))
    throw new Error("Recorded-year annual selection requires frozen research decision IDs.");
  if (request.decisionIds !== undefined && (!Array.isArray(request.decisionIds) || request.decisionIds.length < 1 || request.decisionIds.length > 20
    || new Set(request.decisionIds).size !== request.decisionIds.length)) throw new Error("Select 1 to 20 unique research decision IDs.");
  const decisions = (request.decisionIds ?? []).map(verifyResearchDecision);
  for (const entry of decisions) {
    if (entry.decision.request.declaredDate < start || entry.decision.request.declaredDate > request.valuationCutoff
      || entry.comparisonWindow.start < start || entry.comparisonWindow.end > request.valuationCutoff
      || entry.groupIds.some((id, index) => id !== input.groups[index]?.id)) throw new Error("Annual decisions must match the report's ordered group IDs and year/cutoff; no unrelated or future research.");
  }
  decisions.sort((a, b) => a.decision.request.declaredDate.localeCompare(b.decision.request.declaredDate) || a.decision.recordedAt.localeCompare(b.decision.recordedAt) || a.decision.id.localeCompare(b.decision.id));
  return {
    request: { comparisonId: request.comparisonId, year: request.year, valuationCutoff: request.valuationCutoff,
      ...(request.decisionIds ? { decisionIds: [...request.decisionIds] } : {}),
      ...(request.decisionSelection ? { decisionSelection: request.decisionSelection } : {}) },
    period: request.valuationCutoff.endsWith("-12-31") ? "calendar-year" as const : "year-to-date" as const,
    ...evidence, decisions,
    perspectives: ANNUAL_PERSPECTIVES_V1.filter(view => view.published <= request.valuationCutoff),
    missing: [
      "真实账户业绩未接入：没有历史权益、出入金及费用记录；本报告不计算账户收益。",
      decisions.length ? request.decisionSelection
        ? "生成时本地档案中可核验的匹配研究记录已冻结：不证明全年真实决策完整、用户批准、实际调仓或成交；生成后新增记录不会进入本报告。"
        : "仅展示显式选取的研究决策记录：理由与声明日期为输入声明，不证明当时已作出决策、用户批准、实际调仓或成交。"
        : "策略变更记录未接入：仅选定一份静态研究假设，不能还原年度决策或成交历史。",
      "交易日历覆盖未验证：共同观察日期不等于全年完整交易日，区间外日期与缺失日期不补零。",
    ],
  };
}

export type AnnualResearch = ReturnType<typeof verifyAnnualResearch>;
