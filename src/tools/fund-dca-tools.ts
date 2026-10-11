import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { runDcaBacktest, validateDcaOptions } from "../quant/fund-dca.ts";
import { fundDcaInterpretationNotes } from "../quant/fund-dca-notes.ts";
import { loadFundDcaData } from "../runtime/fund-data.ts";
import { ok } from "./shared/results.ts";

const S = {
  FundDcaBacktest: Type.Object({
    symbol: Type.String({ description: "Fund code, e.g. 270042" }),
    start_date: Type.Optional(Type.String({ description: "DCA start date YYYY-MM-DD; default effective end date minus 5 years" })),
    end_date: Type.Optional(Type.String({ description: "DCA end date YYYY-MM-DD; default latest NAV date" })),
    frequency: Type.Optional(Type.Union([
      Type.Literal("weekly"),
      Type.Literal("biweekly"),
      Type.Literal("monthly"),
      Type.Literal("quarterly"),
    ], { description: "DCA frequency; default monthly" })),
    invest_amount: Type.Optional(Type.Number({ description: "Fixed investment amount per period; default 1000" })),
    invest_day: Type.Optional(Type.Number({ description: "Monthly day-of-month or weekday where Monday=1; default 1" })),
    purchase_fee_rate: Type.Optional(Type.Number({ description: "Purchase fee rate. 0.0013 means 0.13%; 0.13 is also treated as 0.13%" })),
    purchase_fee_unit: Type.Optional(Type.Union([Type.Literal("decimal"), Type.Literal("percent")], { description: "Explicit fee units; omitted keeps legacy auto interpretation for supplied rates. Published fees always use percent units." })),
  }),
};

type FundDcaBacktestArgs = Static<typeof S.FundDcaBacktest>;

export function createFundDcaTool(loadData: typeof loadFundDcaData = loadFundDcaData): AgentTool<typeof S.FundDcaBacktest> {
  return {
    name: "fund_dca_backtest",
    description: "Run fixed-investment DCA on live public fund NAV with immutable input references. Reports cash-flow-adjusted drawdown, principal return and XIRR separately; no account cache.",
    label: "Fund DCA",
    parameters: S.FundDcaBacktest,
    executionMode: "sequential",
    async execute(_id: string, args: FundDcaBacktestArgs, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
      const options = { startDate: args.start_date, endDate: args.end_date, frequency: args.frequency, investAmount: args.invest_amount,
        investDay: args.invest_day, purchaseFeeRate: args.purchase_fee_rate, purchaseFeeUnit: args.purchase_fee_unit };
      validateDcaOptions(options);
      const navData = await loadData(args.symbol, args.purchase_fee_rate === undefined, signal);
      if (navData.nav.length === 0) {
        return ok(
          [`Fund DCA   ${args.symbol}`, "Tool       Tool.quant.fund.dca", "NAV Rows   0"].join("\n"),
          { tool: "Tool.quant.fund.dca", symbol: args.symbol, attempts: navData.attempts },
        );
      }

      const feeRate = args.purchase_fee_rate ?? navData.fee?.rate ?? 0;
      const feeBasis = args.purchase_fee_rate !== undefined ? "explicit-assumption" : navData.fee?.rate != null ? "current-published-assumption" : "unavailable-assumed-zero";
      const dca = runDcaBacktest(navData.nav, { ...options, purchaseFeeRate: feeRate,
        purchaseFeeUnit: args.purchase_fee_rate === undefined ? "decimal" : args.purchase_fee_unit });
      signal?.throwIfAborted();
      const s = dca.summary;
      const latest = navData.nav[navData.nav.length - 1]!;

      return ok(
        [
          `Fund DCA   ${args.symbol}`,
          "Tool       Tool.quant.fund.dca",
          "Source     Tool.akshare.fund.nav",
          `Latest     ${latest.navDate}  NAV=${latest.unitNav.toFixed(4)}`,
          `DCA        ${dca.plan.startDate} -> ${dca.plan.endDate}  ${dca.plan.frequency}  ${money(dca.plan.investAmount)} x ${s.tradeCount}`,
          `Invested   ${money(s.totalPrincipal)}  Value ${money(s.finalMarketValue)}  Profit ${money(s.profit)}`,
          `Principal  ${pctDecimal(s.returnRate)}  XIRR / year ${pctDecimal(s.xirr)}  MaxDD (TWR) ${pctDecimal(s.maxDrawdown)}`,
          `TWR        ${pctDecimal(s.timeWeightedReturn)}  Drawdown excludes external contributions, includes purchase fees`,
          `Fee basis  ${feeBasis}; constant simulation rate, not historical fee evidence`,
          "NAV basis  Unit NAV only; no cash distributions, splits, redemption fees or historical subscription limits",
          `Cost       Avg ${num(s.averageCost, 4)}  Breakeven ${num(s.breakevenNav, 4)}  Fee ${money(s.totalPurchaseFee)}`,
          ...fundDcaInterpretationNotes(dca),
        ].join("\n"),
        {
          tool: "Tool.quant.fund.dca",
          sourceTool: "Tool.akshare.fund.nav",
          provider: "akshare",
          methodVersion: dca.methodVersion,
          dataset: navData.dataset,
          feeBasis,
          symbol: args.symbol,
          latestNav: latest,
          navCurve: navData.nav,
          purchase: navData.purchase,
          dcaPlan: dca.plan,
          dcaSummary: dca.summary,
          dcaTrades: dca.trades,
          dcaAccountCurve: dca.accountCurve,
          attempts: navData.attempts,
        },
      );
    },
  };
}

export const fundDcaBacktestTool = createFundDcaTool();

export const QUANT_FUND_DCA_TOOLS: AgentTool[] = [
  fundDcaBacktestTool,
];

function money(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function pct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "--" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function pctDecimal(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "--" : pct(value * 100);
}

function num(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "--" : value.toFixed(digits);
}
