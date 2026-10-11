import { createHash } from "node:crypto";
import type { PortfolioComparisonArtifact } from "../types/portfolio-comparison.ts";
import type { ResearchDataset } from "./types.ts";
import { resolveResearchBars } from "./input.ts";
import { resolveResearchFund } from "./fund.ts";
import { verifyResearchComparison } from "./comparison.ts";

/** Shared by annual reports and decision evidence; always resolves original public revisions. */
export function verifyArchivedComparison(source: PortfolioComparisonArtifact) {
  const datasets: ResearchDataset[] = [], roles: Record<string, number> = {};
  for (const [index, price] of source.result.input.prices.entries()) {
    if (!price.dataset) continue;
    roles[`price-${index}`] = datasets.length;
    datasets.push(price.dataset.kind === "fund-nav" ? resolveResearchFund(price.dataset) : resolveResearchBars(price.dataset));
  }
  const analysis = verifyResearchComparison("portfolio_comparisons", { id: source.id }, { ...source }, roles, datasets, () => source);
  if (!analysis.comparison) throw new Error("Research requires a verified comparison curve.");
  return { source, datasets, analysis, comparison: analysis.comparison,
    comparisonHash: createHash("sha256").update(JSON.stringify(source)).digest("hex") };
}
