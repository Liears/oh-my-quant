import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  fetchAkshareRows,
  fetchAkshareFundNav,
  type AkshareFundHistory,
  type AkshareRowsResult,
  type FundAchievementRow,
  type FundNavDaily,
  type FundRiskAnalysisRow,
} from "../source/index.ts";
import { ok } from "./shared/results.ts";
import {
  formatCell,
  formatRecordPreview,
  textValue,
} from "./shared/row-preview.ts";
import {
  runAllSources,
  runFirstSource,
  type SourceAttempt,
  type SourceCandidate,
} from "./shared/source-runner.ts";
import {
  AKSHARE_FUND_ENDPOINT_TOOL_REGISTRATIONS,
  AKSHARE_FUND_ENDPOINT_TOOLS,
  AKSHARE_FUND_PREVIEW_FIELD_PRIORITY,
  filterAkshareFundRows,
} from "./akshare-fund-endpoint-tools.ts";

const FundSymbolWithPriority = Type.Object({
  symbol: Type.String({ description: "Fund code, e.g. 270042" }),
  source_priority: Type.Optional(Type.String({ description: "Comma-separated preferred providers or endpoints, e.g. 东方财富,雪球,同花顺 or fund_overview_em,fund_info_ths" })),
});

const FundFeeRequest = Type.Object({
  symbol: Type.String({ description: "Fund code, e.g. 270042" }),
  indicator: Type.Optional(Type.String({ description: "Fee/rule indicator, e.g. 申购费率（前端）, 赎回费率, 交易状态" })),
  source_priority: Type.Optional(Type.String({ description: "Comma-separated preferred providers or endpoints, e.g. 东方财富,雪球 or fund_fee_em,fund_individual_detail_info_xq" })),
});

type FundSymbolWithPriorityArgs = Static<typeof FundSymbolWithPriority>;
type FundFeeRequestArgs = Static<typeof FundFeeRequest>;

export interface AkshareFundToolRegistration {
  name: string;
  label: string;
}

function profileSourceCandidates(): SourceCandidate<Record<string, unknown>>[] {
  return [
    {
      id: "eastmoney",
      provider: "eastmoney",
      endpoint: "fund_overview_em",
      fetch: async (symbol) => {
        const data = await fetchAkshareRows("fund_overview_em", { symbol });
        return data.rows[0] ? { ...data.rows[0] } : {};
      },
      isHit: (value) => Object.keys(value).length > 0,
    },
    {
      id: "ths",
      provider: "ths",
      endpoint: "fund_info_ths",
      fetch: async (symbol) => keyValueRows(await fetchAkshareRows("fund_info_ths", { symbol }), "字段", "值"),
      isHit: (value) => Object.keys(value).length > 0,
    },
    {
      id: "xq",
      provider: "xq",
      endpoint: "fund_individual_basic_info_xq",
      fetch: async (symbol) => keyValueRows(await fetchAkshareRows("fund_individual_basic_info_xq", { symbol }), "item", "value"),
      isHit: (value) => Object.keys(value).length > 0,
    },
  ];
}

function navSourceCandidates(): SourceCandidate<FundNavDaily[]>[] {
  return [
    {
      id: "open_fund_em",
      provider: "eastmoney",
      endpoint: "fund_open_fund_info_em",
      fetch: async (symbol) => (await fetchAkshareFundNav(symbol)).nav,
      isHit: (value) => value.length > 0,
    },
    {
      id: "exchange_fund_em",
      provider: "eastmoney",
      endpoint: "fund_etf_fund_info_em",
      fetch: async (symbol) => normalizeNavRows(
        symbol,
        (await fetchAkshareRows("fund_etf_fund_info_em", { fund: symbol, start_date: "20000101", end_date: "20500101" })).rows,
        "akshare:fund_etf_fund_info_em",
      ),
      isHit: (value) => value.length > 0,
    },
    {
      id: "graded_fund_em",
      provider: "eastmoney",
      endpoint: "fund_graded_fund_info_em",
      fetch: async (symbol) => normalizeNavRows(
        symbol,
        (await fetchAkshareRows("fund_graded_fund_info_em", { symbol })).rows,
        "akshare:fund_graded_fund_info_em",
      ),
      isHit: (value) => value.length > 0,
    },
    {
      id: "financial_fund_em",
      provider: "eastmoney",
      endpoint: "fund_financial_fund_info_em",
      fetch: async (symbol) => normalizeNavRows(
        symbol,
        (await fetchAkshareRows("fund_financial_fund_info_em", { symbol })).rows,
        "akshare:fund_financial_fund_info_em",
      ),
      isHit: (value) => value.length > 0,
    },
  ];
}

function purchaseSourceCandidates(): SourceCandidate<Record<string, unknown>>[] {
  return [
    {
      id: "eastmoney_purchase",
      provider: "eastmoney",
      endpoint: "fund_purchase_em",
      fetch: async (symbol) => filterAkshareFundRows((await fetchAkshareRows("fund_purchase_em")).rows, { fund_code: symbol })[0] ?? {},
      isHit: (value) => Object.keys(value).length > 0,
    },
    {
      id: "eastmoney_open_daily",
      provider: "eastmoney",
      endpoint: "fund_open_fund_daily_em",
      fetch: async (symbol) => filterAkshareFundRows((await fetchAkshareRows("fund_open_fund_daily_em")).rows, { fund_code: symbol })[0] ?? {},
      isHit: (value) => Object.keys(value).length > 0,
    },
    {
      id: "ths_qdii_daily",
      provider: "ths",
      endpoint: "fund_etf_category_ths",
      fetch: async (symbol) => filterAkshareFundRows((await fetchAkshareRows("fund_etf_category_ths", { symbol: "QDII" })).rows, { fund_code: symbol })[0] ?? {},
      isHit: (value) => Object.keys(value).length > 0,
    },
  ];
}

function feeSourceCandidates(indicator: string): SourceCandidate<Record<string, unknown>[]>[] {
  return [
    {
      id: "eastmoney_fee",
      provider: "eastmoney",
      endpoint: "fund_fee_em",
      fetch: async (symbol) => (await fetchAkshareRows("fund_fee_em", { symbol, indicator })).rows,
      isHit: (value) => value.length > 0,
    },
    {
      id: "xq_trade_rule",
      provider: "xq",
      endpoint: "fund_individual_detail_info_xq",
      fetch: async (symbol) => filterFeeRows((await fetchAkshareRows("fund_individual_detail_info_xq", { symbol })).rows, indicator),
      isHit: (value) => value.length > 0,
    },
  ];
}

function performanceSourceCandidates(): SourceCandidate<FundAchievementRow[]>[] {
  return [
    {
      id: "xq_achievement",
      provider: "xq",
      endpoint: "fund_individual_achievement_xq",
      fetch: async (symbol) => (await fetchAkshareRows("fund_individual_achievement_xq", { symbol })).rows.map(rowToAchievement),
      isHit: (value) => value.length > 0,
    },
    {
      id: "eastmoney_rank",
      provider: "eastmoney",
      endpoint: "fund_open_fund_rank_em",
      fetch: async (symbol) => {
        const row = filterAkshareFundRows((await fetchAkshareRows("fund_open_fund_rank_em", { symbol: "全部" })).rows, { fund_code: symbol })[0];
        return row ? rankRowToAchievements(row) : [];
      },
      isHit: (value) => value.length > 0,
    },
  ];
}

function keyValueRows(data: AkshareRowsResult, keyField: string, valueField: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of data.rows) {
    const key = textValue(row[keyField]);
    if (key) out[key] = row[valueField];
  }
  return out;
}

function mergeRecordsByPriority(records: Array<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (out[key] == null || out[key] === "") out[key] = value;
    }
  }
  return out;
}

function normalizeNavRows(symbol: string, rows: Record<string, unknown>[], source: string): FundNavDaily[] {
  return rows.map((row) => {
    const navDate = textValue(row["净值日期"] ?? row["日期"]);
    const unitNav = numberOrNull(row["单位净值"] ?? row["当前-单位净值"] ?? row["最新-单位净值"]);
    if (!navDate || unitNav == null) return null;
    return {
      fundCode: symbol,
      navDate,
      unitNav,
      accumulatedNav: numberOrNull(row["累计净值"] ?? row["当前-累计净值"] ?? row["最新-累计净值"]),
      dailyReturnPct: numberOrNull(row["日增长率"] ?? row["增长率"]),
      isOpenDay: true,
      source,
    };
  }).filter((row): row is FundNavDaily => Boolean(row));
}

function filterFeeRows(rows: Record<string, unknown>[], indicator: string): Record<string, unknown>[] {
  if (indicator.includes("赎回") || indicator.includes("卖出")) {
    return rows.filter((row) => textValue(row["费用类型"]).includes("卖出"));
  }
  if (indicator.includes("申购") || indicator.includes("认购") || indicator.includes("买入")) {
    return rows.filter((row) => textValue(row["费用类型"]).includes("买入"));
  }
  if (indicator.includes("运作") || indicator.includes("管理") || indicator.includes("托管")) {
    return rows.filter((row) => textValue(row["费用类型"]).includes("其他"));
  }
  return rows;
}

function rowToAchievement(row: Record<string, unknown>): FundAchievementRow {
  return {
    type: textValue(row["业绩类型"]),
    period: textValue(row["周期"]),
    returnPct: numberOrNull(row["本产品区间收益"]),
    maxDrawdownPct: numberOrNull(row["本产品最大回撤"] ?? row["本产品最大回撒"]),
    rank: row["周期收益同类排名"] == null ? null : textValue(row["周期收益同类排名"]),
  };
}

function rankRowToAchievements(row: Record<string, unknown>): FundAchievementRow[] {
  const periods = ["近1周", "近1月", "近3月", "近6月", "近1年", "近2年", "近3年", "今年来", "成立来"];
  return periods
    .filter((period) => row[period] != null && row[period] !== "")
    .map((period) => ({
      type: "阶段业绩",
      period,
      returnPct: numberOrNull(row[period]),
      maxDrawdownPct: null,
      rank: null,
    }));
}

function formatSourceAttempts(attempts: SourceAttempt[]): string {
  const text = attempts.map((attempt) => `${attempt.endpoint}:${attempt.status}`).join("  ");
  return text || "--";
}

function formatRowsPreview(title: string, toolLabel: string, source: string, rows: Record<string, unknown>[]): string {
  const lines = [title, `Tool       ${toolLabel}`, `Source     ${source}`, `Rows       ${rows.length}`];
  lines.push(...formatRecordPreview(rows, AKSHARE_FUND_PREVIEW_FIELD_PRIORITY, { maxFields: 7, maxRows: 8, cellMaxLength: 28 }));
  return lines.join("\n");
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const akshareFundNavTool: AgentTool<typeof FundSymbolWithPriority> = {
  name: "akshare_fund_nav",
  description: "Live AKShare fund NAV curve with source priority and fallback. No cache.",
  label: "AKShare Fund NAV",
  parameters: FundSymbolWithPriority,
  executionMode: "sequential",
  async execute(_id: string, args: FundSymbolWithPriorityArgs): Promise<AgentToolResult<unknown>> {
    const result = await runFirstSource(args.symbol, args.source_priority, navSourceCandidates());
    const nav = result.value ?? [];
    const latest = nav[nav.length - 1];
    if (!latest) {
      return ok(
        [`Fund NAV   ${args.symbol}`, "Tool       Tool.akshare.fund.nav", "Rows       0", `Sources    ${formatSourceAttempts(result.attempts)}`].join("\n"),
        { tool: "Tool.akshare.fund.nav", symbol: args.symbol, navCurve: [], sourceAttempts: result.attempts },
      );
    }
    return ok(
      [
        `Fund NAV   ${args.symbol}`,
        "Tool       Tool.akshare.fund.nav",
        `Source     ${result.candidate?.endpoint || latest.source}`,
        `Latest     ${latest.navDate}  NAV=${latest.unitNav.toFixed(4)}  Acc=${num(latest.accumulatedNav, 4)}  Day=${pct(latest.dailyReturnPct)}`,
        `Rows       ${nav.length}`,
        `Range      ${nav[0]?.navDate} -> ${latest.navDate}`,
        `Sources    ${formatSourceAttempts(result.attempts)}`,
      ].join("\n"),
      {
        tool: "Tool.akshare.fund.nav",
        provider: "akshare",
        endpoint: result.candidate?.endpoint,
        symbol: args.symbol,
        latestNav: latest,
        navCurve: nav,
        sourcePriority: args.source_priority,
        sourceAttempts: result.attempts,
      },
    );
  },
};

export const akshareFundProfileTool: AgentTool<typeof FundSymbolWithPriority> = {
  name: "akshare_fund_profile",
  description: "Live AKShare fund basic profile with source priority, multi-source merge, and fallback. No cache.",
  label: "AKShare Fund Profile",
  parameters: FundSymbolWithPriority,
  executionMode: "sequential",
  async execute(_id: string, args: FundSymbolWithPriorityArgs): Promise<AgentToolResult<unknown>> {
    const result = await runAllSources(args.symbol, args.source_priority, profileSourceCandidates());
    const profile = mergeRecordsByPriority(result.values.map((entry) => entry.value));
    const fund = normalizeFundCard({
      symbol: args.symbol,
      fetchedAt: "",
      nav: [],
      profile,
      rank: {},
      purchase: {},
      achievement: [],
      analysis: [],
      attempts: [],
    });
    return ok(
      [
        `Fund       ${String(fund.name || args.symbol)} (${args.symbol})`,
        "Tool       Tool.akshare.fund.profile",
        `Sources    ${formatSourceAttempts(result.attempts)}`,
        `Profile    ${compact([fund.fundType, fund.investmentType, fund.manager ? `Manager ${fund.manager}` : null, fund.scale ? `Scale ${fund.scale}` : null])}`,
        `Company    ${compact([fund.managementCompany, fund.custodian ? `Custodian ${fund.custodian}` : null])}`,
        `Benchmark  ${String(fund.benchmark || "--")}`,
      ].join("\n"),
      {
        tool: "Tool.akshare.fund.profile",
        provider: "akshare",
        endpoints: result.values.map((entry) => entry.candidate.endpoint),
        sourcePriority: args.source_priority,
        sourceAttempts: result.attempts,
        fund,
        profile,
      },
    );
  },
};

export const akshareFundPurchaseTool: AgentTool<typeof FundSymbolWithPriority> = {
  name: "akshare_fund_purchase",
  description: "Live AKShare fund purchase/redemption status with source priority and fallback. No cache.",
  label: "AKShare Fund Purchase",
  parameters: FundSymbolWithPriority,
  executionMode: "sequential",
  async execute(_id: string, args: FundSymbolWithPriorityArgs): Promise<AgentToolResult<unknown>> {
    const result = await runFirstSource(args.symbol, args.source_priority, purchaseSourceCandidates());
    const p = result.value ?? {};
    return ok(
      [
        `Fund Trade ${String(p["基金简称"] || args.symbol)} (${args.symbol})`,
        "Tool       Tool.akshare.fund.purchase",
        `Source     ${result.candidate?.endpoint || "--"}`,
        `Buy        ${String(p["申购状态"] || "--")}  Min ${String(p["购买起点"] ?? "--")}  Limit ${String(p["日累计限定金额"] ?? "--")}`,
        `Redeem     ${String(p["赎回状态"] || "--")}`,
        `Fee        ${formatPercentLike(p["手续费"])}`,
        `Sources    ${formatSourceAttempts(result.attempts)}`,
      ].join("\n"),
      {
        tool: "Tool.akshare.fund.purchase",
        provider: "akshare",
        endpoint: result.candidate?.endpoint,
        symbol: args.symbol,
        sourcePriority: args.source_priority,
        sourceAttempts: result.attempts,
        purchase: p,
      },
    );
  },
};

export const akshareFundFeeTool: AgentTool<typeof FundFeeRequest> = {
  name: "akshare_fund_fee",
  description: "Live AKShare fund fee and trade-rule rows with source priority and fallback. No cache.",
  label: "AKShare Fund Fee",
  parameters: FundFeeRequest,
  executionMode: "sequential",
  async execute(_id: string, args: FundFeeRequestArgs): Promise<AgentToolResult<unknown>> {
    const indicator = args.indicator || "申购费率（前端）";
    const result = await runFirstSource(args.symbol, args.source_priority, feeSourceCandidates(indicator));
    const rows = result.value ?? [];
    return ok(
      [
        formatRowsPreview(`Fund Fee   ${args.symbol}`, "Tool.akshare.fund.fee", result.candidate?.endpoint || "--", rows),
        `Indicator  ${indicator}`,
        `Sources    ${formatSourceAttempts(result.attempts)}`,
      ].join("\n"),
      {
        tool: "Tool.akshare.fund.fee",
        provider: "akshare",
        endpoint: result.candidate?.endpoint,
        symbol: args.symbol,
        indicator,
        sourcePriority: args.source_priority,
        sourceAttempts: result.attempts,
        rows,
      },
    );
  },
};

export const akshareFundPerformanceTool: AgentTool<typeof FundSymbolWithPriority> = {
  name: "akshare_fund_performance",
  description: "Live AKShare fund stage performance, drawdown/rank, and risk rows with source priority and fallback. No cache.",
  label: "AKShare Fund Performance",
  parameters: FundSymbolWithPriority,
  executionMode: "sequential",
  async execute(_id: string, args: FundSymbolWithPriorityArgs): Promise<AgentToolResult<unknown>> {
    const result = await runFirstSource(args.symbol, args.source_priority, performanceSourceCandidates());
    const riskResult = await runFirstSource<FundRiskAnalysisRow[]>(args.symbol, args.source_priority, [
      {
        id: "xq_analysis",
        provider: "xq",
        endpoint: "fund_individual_analysis_xq",
        fetch: async (symbol) => (await fetchAkshareRows("fund_individual_analysis_xq", { symbol })).rows.map((row) => ({
          period: textValue(row["周期"]),
          riskReturnScore: numberOrNull(row["较同类风险收益比"]),
          antiVolatilityScore: numberOrNull(row["较同类抗风险波动"]),
          annualVolatilityPct: numberOrNull(row["年化波动率"]),
          annualSharpe: numberOrNull(row["年化夏普比率"]),
          maxDrawdownPct: numberOrNull(row["最大回撤"]),
        })),
        isHit: (value) => value.length > 0,
      },
    ]);
    const periods = pickStagePeriods(result.value ?? []);
    const sourceAttempts = [...result.attempts, ...riskResult.attempts];
    return ok(
      [
        formatFundPerformanceText(args.symbol, periods, riskResult.value ?? []),
        `Source     ${result.candidate?.endpoint || "--"}`,
        `Sources    ${formatSourceAttempts(sourceAttempts)}`,
      ].join("\n"),
      {
        tool: "Tool.akshare.fund.performance",
        provider: "akshare",
        endpoint: result.candidate?.endpoint,
        symbol: args.symbol,
        sourcePriority: args.source_priority,
        sourceAttempts,
        periodPerformance: periods,
        riskAnalysis: riskResult.value ?? [],
      },
    );
  },
};

export const AKSHARE_FUND_TOOLS: AgentTool[] = [
  akshareFundNavTool,
  akshareFundProfileTool,
  akshareFundPurchaseTool,
  akshareFundFeeTool,
  akshareFundPerformanceTool,
  ...AKSHARE_FUND_ENDPOINT_TOOLS,
];

export const AKSHARE_FUND_TOOL_REGISTRATIONS: AkshareFundToolRegistration[] = [
  { name: "akshare_fund_nav", label: "Tool.akshare.fund.nav" },
  { name: "akshare_fund_profile", label: "Tool.akshare.fund.profile" },
  { name: "akshare_fund_purchase", label: "Tool.akshare.fund.purchase" },
  { name: "akshare_fund_fee", label: "Tool.akshare.fund.fee" },
  { name: "akshare_fund_performance", label: "Tool.akshare.fund.performance" },
  ...AKSHARE_FUND_ENDPOINT_TOOL_REGISTRATIONS,
];

function normalizeFundCard(data: AkshareFundHistory): Record<string, unknown> {
  const p = data.profile;
  return {
    code: data.symbol,
    name: pick(p["基金简称"], p["基金名称"]),
    fullName: pick(p["基金全称"], p["基金名称"]),
    fundType: pick(p["基金类型"]),
    investmentType: pick(p["投资类型"]),
    manager: pick(p["基金经理"], p["基金经理人"]),
    inceptionDate: pick(p["成立日期"], p["成立时间"]),
    scale: pick(p["最新规模"], p["净资产规模"], p["资产规模"], p["份额规模"]),
    managementCompany: pick(p["基金管理人"], p["基金公司"]),
    custodian: pick(p["基金托管人"], p["托管银行"]),
    benchmark: pick(p["业绩比较基准"]),
  };
}

function pick(...values: unknown[]): unknown {
  return values.find((value) => value != null && value !== "") ?? null;
}

function pickStagePeriods(rows: FundAchievementRow[]): FundAchievementRow[] {
  const wanted = ["近1月", "近3月", "近6月", "近1年", "近3年", "近5年"];
  const wantedSet = new Set(wanted);
  const stage = rows.filter((row) => wantedSet.has(row.period));
  return [...stage].sort((a, b) => wanted.indexOf(a.period) - wanted.indexOf(b.period));
}

function formatFundPerformanceText(symbol: string, periods: FundAchievementRow[], riskRows: FundRiskAnalysisRow[]): string {
  const rows = [
    `Fund Perf  ${symbol}`,
    "Tool       Tool.akshare.fund.performance",
    "Mode       source-priority fallback",
  ];
  if (periods.length > 0) {
    rows.push("Periods    Return   MaxDD    Rank");
    for (const row of periods) {
      rows.push(`${row.period.padEnd(9)} ${pct(row.returnPct).padStart(7)} ${pct(row.maxDrawdownPct).padStart(7)} ${String(row.rank || "--").padStart(8)}`);
    }
  }
  if (riskRows.length > 0) {
    const risk = riskRows[0]!;
    rows.push(`Risk       ${risk.period || "--"}  Vol ${pct(risk.annualVolatilityPct)}  Sharpe ${num(risk.annualSharpe, 2)}  MaxDD ${pct(risk.maxDrawdownPct)}`);
  }
  return rows.join("\n");
}

function formatPercentLike(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return `${value.toFixed(2)}%`;
  if (typeof value === "string" && value.trim()) return value.includes("%") ? value : `${value}%`;
  return "--";
}

function compact(values: unknown[]): string {
  const text = values.filter(Boolean).map(String).join("  ");
  return text || "--";
}

function pct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "--" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function num(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "--" : value.toFixed(digits);
}
