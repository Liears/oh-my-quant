import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { runDcaBacktest, type DcaFrequency } from "../quant/fund-dca.ts";
import { fetchAkshareFundNav, fetchAkshareFundPurchase } from "../source/index.ts";
import { ok } from "./shared/results.ts";

const S = {
  FundDcaBacktest: Type.Object({
    symbol: Type.String({ description: "Fund code, e.g. 270042" }),
    start_date: Type.Optional(Type.String({ description: "DCA start date YYYY-MM-DD; default latest NAV date minus 5 years" })),
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
  }),
};

type FundDcaBacktestArgs = Static<typeof S.FundDcaBacktest>;

export const fundDcaBacktestTool: AgentTool<typeof S.FundDcaBacktest> = {
  name: "fund_dca_backtest",
  description: "Run fixed-investment DCA backtest on live AKShare fund NAV. No cache.",
  label: "Fund DCA",
  parameters: S.FundDcaBacktest,
  executionMode: "sequential",
  async execute(_id: string, args: FundDcaBacktestArgs): Promise<AgentToolResult<unknown>> {
    const [navData, purchaseData] = await Promise.all([
      fetchAkshareFundNav(args.symbol),
      args.purchase_fee_rate == null ? fetchAkshareFundPurchase(args.symbol) : Promise.resolve(null),
    ]);
    if (navData.nav.length === 0) {
      return ok(
        [`Fund DCA   ${args.symbol}`, "Tool       Tool.quant.fund.dca", "NAV Rows   0"].join("\n"),
        { tool: "Tool.quant.fund.dca", symbol: args.symbol, attempts: navData.attempts },
      );
    }

    const feeRate = args.purchase_fee_rate ?? inferPurchaseFeeRate(purchaseData?.purchase ?? {});
    const dca = runDcaBacktest(navData.nav, {
      startDate: args.start_date,
      endDate: args.end_date,
      frequency: args.frequency as DcaFrequency | undefined,
      investAmount: args.invest_amount,
      investDay: args.invest_day,
      purchaseFeeRate: feeRate,
    });
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
        `Return     ${pctDecimal(s.returnRate)}  XIRR ${pctDecimal(s.xirr)}  MaxDD ${pctDecimal(s.maxDrawdown)}`,
        `Cost       Avg ${num(s.averageCost, 4)}  Breakeven ${num(s.breakevenNav, 4)}  Fee ${money(s.totalPurchaseFee)}`,
      ].join("\n"),
      {
        tool: "Tool.quant.fund.dca",
        sourceTool: "Tool.akshare.fund.nav",
        provider: "akshare",
        symbol: args.symbol,
        latestNav: latest,
        navCurve: navData.nav,
        purchase: purchaseData?.purchase ?? {},
        dcaPlan: dca.plan,
        dcaSummary: dca.summary,
        dcaTrades: dca.trades,
        dcaAccountCurve: dca.accountCurve,
        attempts: [...navData.attempts, ...(purchaseData?.attempts ?? [])],
      },
    );
  },
};

export const QUANT_FUND_DCA_TOOLS: AgentTool[] = [
  fundDcaBacktestTool,
];

function inferPurchaseFeeRate(row: Record<string, unknown>): number {
  const raw = row["手续费"];
  const n = typeof raw === "number"
    ? raw
    : typeof raw === "string"
      ? Number(raw.replace("%", "").trim())
      : Number.NaN;
  return Number.isFinite(n) ? n / 100 : 0;
}

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
