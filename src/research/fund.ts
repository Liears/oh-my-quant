import { createHash } from "node:crypto";
import { normalizeFundNav, normalizeFundSymbol, publicFundFee, publicFundNavRef } from "../market/fund-nav.ts";
import {
  runDcaBacktest, fundDcaInterpretationNotes, type DcaBacktestOptions,
} from "../quant/index.ts";
import { loadFundNavDataset } from "../storage/index.ts";
import type { FundNavDatasetRef, FundNavSnapshot } from "../types/fund-data.ts";
import type { ResearchAnalysis, ResearchDataset, ResearchFundDataset } from "./types.ts";
import { matches } from "./match.ts";

export const FUND_RESEARCH_METRICS = {
  returnRate: "Principal return", timeWeightedReturn: "Time-weighted return", xirr: "XIRR",
  maxDrawdown: "Maximum drawdown (TWR)", tradeCount: "Purchases",
} as const;

export function resolveResearchFund(candidate: unknown, resolve: (ref: FundNavDatasetRef) => FundNavSnapshot = loadFundNavDataset): ResearchFundDataset {
  const ref = publicFundNavRef(candidate), saved = resolve(ref);
  const nav = normalizeFundNav(ref.symbol, saved.nav), fee = publicFundFee(saved.fee);
  const payload = { version: 1, symbol: ref.symbol, source: "akshare", endpoint: ref.endpoint, fetchedAt: ref.snapshotAt, nav, fee };
  if (createHash("sha256").update(JSON.stringify(payload)).digest("hex") !== ref.revision
    || createHash("sha256").update(JSON.stringify(nav)).digest("hex") !== ref.contentHash
    || nav.length !== ref.dates.length || nav.some((row, i) => row.navDate !== ref.dates[i])) throw new Error("Fund NAV observation mismatch.");
  return { ref, nav, fee };
}

export function verifyFundResearch(args: Record<string, unknown>, saved: Record<string, unknown>, index: number | undefined, datasets: ResearchDataset[]): ResearchAnalysis {
  const input = index === undefined ? undefined : datasets[index];
  if (!input || !("nav" in input) || typeof args.symbol !== "string" || normalizeFundSymbol(args.symbol) !== input.ref.symbol
    || saved.symbol !== args.symbol || saved.provider !== "akshare") throw new Error("Missing matching fund input.");
  for (const name of ["start_date", "end_date"]) if (args[name] !== undefined && typeof args[name] !== "string") throw new Error("Invalid DCA dates.");
  for (const name of ["invest_amount", "invest_day", "purchase_fee_rate"]) if (args[name] !== undefined && typeof args[name] !== "number") throw new Error("Invalid DCA parameters.");
  if (args.frequency !== undefined && !["weekly", "biweekly", "monthly", "quarterly"].includes(String(args.frequency))) throw new Error("Invalid DCA frequency.");
  if (args.purchase_fee_unit !== undefined && !["decimal", "percent"].includes(String(args.purchase_fee_unit))) throw new Error("Invalid DCA fee units.");
  const explicitFee = args.purchase_fee_rate !== undefined;
  if (!explicitFee && !input.fee) throw new Error("Missing observed fee status.");
  const feeBasis = explicitFee ? "explicit-assumption" : input.fee?.rate != null ? "current-published-assumption" : "unavailable-assumed-zero";
  const result = runDcaBacktest(input.nav, {
    startDate: args.start_date as string | undefined, endDate: args.end_date as string | undefined,
    frequency: args.frequency as DcaBacktestOptions["frequency"], investAmount: args.invest_amount as number | undefined,
    investDay: args.invest_day as number | undefined, purchaseFeeRate: explicitFee ? args.purchase_fee_rate as number : input.fee?.rate ?? 0,
    purchaseFeeUnit: explicitFee ? args.purchase_fee_unit as DcaBacktestOptions["purchaseFeeUnit"] : "decimal",
  });
  if (!matches(saved, { methodVersion: result.methodVersion, feeBasis, navCurve: input.nav, latestNav: input.nav.at(-1), dcaPlan: result.plan, dcaSummary: result.summary, dcaTrades: result.trades, dcaAccountCurve: result.accountCurve })) throw new Error("DCA result mismatch.");
  return { kind: "fund-dca", title: `${input.ref.symbol} · DCA (${result.plan.frequency})`, datasetIndexes: [index!],
    assumptions: [
      `Effective plan: ${result.plan.startDate} — ${result.plan.endDate}; investment day ${result.plan.investDay}.`,
      `Requested: ${args.start_date ?? "effective end minus 5 years"} — ${args.end_date ?? "latest NAV"}; end is capped at latest NAV; start more than 31 days before history is clipped.`,
      `Purchase fee ${result.plan.purchaseFeeRate}; ${feeBasis}. Published current fees are a constant assumption, not historical fee evidence.`,
      "Equal periodic contributions; next observed NAV; fractional units. Historical subscription availability not verified.",
      "Unit NAV only; excludes cash distributions, splits and redemption costs. Not a total-return fund history.",
      ...fundDcaInterpretationNotes(result),
    ],
    metrics: [{ label: FUND_RESEARCH_METRICS.returnRate, value: result.summary.returnRate, unit: "percent" }, { label: FUND_RESEARCH_METRICS.timeWeightedReturn, value: result.summary.timeWeightedReturn, unit: "percent" },
      { label: FUND_RESEARCH_METRICS.xirr, value: result.summary.xirr, unit: "percent" }, { label: FUND_RESEARCH_METRICS.maxDrawdown, value: result.summary.maxDrawdown, unit: "percent" }, { label: FUND_RESEARCH_METRICS.tradeCount, value: result.summary.tradeCount, unit: "number" }],
    curve: { dates: result.accountCurve.map(point => point.date), values: result.accountCurve.map(point => point.performanceIndex), basis: "cash-flow-adjusted" },
  };
}
