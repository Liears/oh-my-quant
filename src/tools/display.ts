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
  fetch_bars: { label: "AKShare · Daily Bars", provider: "akshare" },
  search_symbols: { label: "Tushare · Search", provider: "joinquant" },
  fetch_snapshot: { label: "Direct · Snapshot" },
  fetch_index_spot: { label: "AKShare · Index Spot", provider: "akshare" },
  fetch_index_info: { label: "AKShare · Index Info", provider: "akshare" },
  fetch_index_constituents: { label: "AKShare · Index Constituents", provider: "akshare" },
  fetch_index_rows: { label: "AKShare · Index Rows", provider: "akshare" },
  compute_factor: { label: "Quant.Factor" },
  run_backtest: { label: "Quant.Backtest" },
  check_risk: { label: "Quant.Risk" },
  fund_dca_backtest: { label: "Tool.quant.fund.dca" },
  score_benchmark: { label: "Quant.Benchmark" },
  show_dashboard: { label: "Quant.Dashboard" },
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
