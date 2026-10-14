import type { ResearchAnalysis, ResearchDataset } from "./types.ts";
import { verifyResearchAnalysis } from "./analysis.ts";
import { verifyAppArchiveBoundary } from "./observation-boundary.ts";

const BY_MODE = { factor: "compute_factor", backtest: "run_backtest", risk: "check_risk" } as const;

/** Recompute an archived study with the original price verifier, then bind its UTC observation boundary. */
export function verifyArchivedResearchAnalysis(args: Record<string, unknown>, saved: Record<string, unknown>,
  roles: Record<string, number>, datasets: ResearchDataset[]): ResearchAnalysis {
  const mode = args.analysis;
  if (mode !== "factor" && mode !== "backtest" && mode !== "risk" || saved.analysis !== mode)
    throw new Error("Archived analysis mode mismatch");
  verifyAppArchiveBoundary(args, saved, roles, datasets);
  return verifyResearchAnalysis(BY_MODE[mode], args, saved, roles, datasets);
}
