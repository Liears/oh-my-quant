import { shellDisplayName } from "./shell.ts";

export type BuiltinToolDomain = "data" | "quant" | "system";

export type DataProvider =
  | "akshare"
  | "tushare"
  | "llmquant"
  | "financial-datasets"
  | "joinquant";

export interface ToolDisplay {
  label: string;
  provider?: DataProvider;
}

const TOOL_DISPLAYS: Record<string, ToolDisplay> = {
  fetch_bars: { label: "Market Data · Daily Bars" },
  fetch_bars_archive: { label: "Market Data · Archive Bars" },
  search_symbols: { label: "Tushare · Search", provider: "tushare" },
  fetch_snapshot: { label: "Direct · Snapshot" },
  fetch_index_spot: { label: "AKShare · Index Spot", provider: "akshare" },
  fetch_index_info: { label: "AKShare · Index Info", provider: "akshare" },
  fetch_index_constituents: { label: "AKShare · Index Constituents", provider: "akshare" },
  fetch_index_rows: { label: "AKShare · Index Rows", provider: "akshare" },
  compute_factor: { label: "Quant.Factor" },
  run_backtest: { label: "Quant.Backtest" },
  alpha_backtest: { label: "Alpha.Backtest" },
  alpha_runs: { label: "Alpha.Runs" },
  alpha_engine_status: { label: "Alpha.Engine" },
  check_risk: { label: "Quant.Risk" },
  calculate_weighted_score: { label: "Quant.WeightedScore" },
  calculate_position_scenarios: { label: "Quant.PositionScenarios" },
  analyze_archived_bars: { label: "Quant.ArchiveAnalysis" },
  fund_dca_backtest: { label: "Tool.quant.fund.dca" },
  score_benchmark: { label: "Quant.Benchmark" },
  show_dashboard: { label: "Quant.Dashboard" },
  list_portfolios: { label: "Quant.Portfolios" },
  edit_portfolio: { label: "Quant.PortfolioEdit" },
  compare_portfolios: { label: "Quant.Compare" },
  portfolio_comparisons: { label: "Quant.Comparisons" },
  research_task: { label: "Quant.Research" },
  research_news: { label: "Quant.News" },
  annual_report: { label: "Quant.AnnualReport" },
  annual_reports: { label: "Quant.AnnualReports" },
  research_decisions: { label: "Quant.Decisions" },
};

export function builtinToolDisplay(name: string): ToolDisplay | undefined {
  if (name === "bash") return { label: shellDisplayName() };
  const akshareFund = akshareFundDisplay(name);
  return akshareFund ?? TOOL_DISPLAYS[name];
}

function akshareFundDisplay(name: string): ToolDisplay | undefined {
  const prefix = "akshare_fund_";
  if (!name.startsWith(prefix)) return undefined;
  return { label: `Tool.akshare.fund.${name.slice(prefix.length)}`, provider: "akshare" };
}
