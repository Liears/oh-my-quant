import { Type } from "typebox";
import type { TSchema } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  fetchAkshareRows,
  type AksharePublicFundEndpoint,
} from "../source/index.ts";
import { ok } from "./shared/results.ts";
import {
  formatRecordPreview,
  outputLimit,
  textValue,
} from "./shared/row-preview.ts";

type EndpointParameterSchemas = Record<string, TSchema>;

interface AkshareFundEndpointSpec {
  endpoint: AksharePublicFundEndpoint;
  description: string;
  params: EndpointParameterSchemas;
}

export interface AkshareFundEndpointToolRegistration {
  name: string;
  label: string;
}

const COMMON_ENDPOINT_OPTIONS: EndpointParameterSchemas = {
  fund_code: Type.Optional(Type.String({ description: "Local output filter for fund code, e.g. 270042. Not passed to AKShare." })),
  keyword: Type.Optional(Type.String({ description: "Local output filter across returned values. Not passed to AKShare." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum rows to include in tool output/details. Default 12." })),
};

const AKSHARE_FUND_ENDPOINT_SPECS: AkshareFundEndpointSpec[] = [
  { endpoint: "fund_name_em", description: "东方财富-天天基金-所有基金基本信息", params: {} },
  { endpoint: "fund_info_ths", description: "同花顺-基金基本信息", params: { symbol: codeParam("基金代码, e.g. 270042") } },
  { endpoint: "fund_individual_basic_info_xq", description: "雪球-单只基金基本信息", params: { symbol: codeParam("基金代码, e.g. 270042"), timeout: optNumberParam("Optional request timeout") } },
  { endpoint: "fund_info_index_em", description: "东方财富-天天基金-指数型基金基本信息", params: { symbol: optStringParam("全部/沪深指数/行业主题/大盘指数/中盘指数/小盘指数/股票指数/债券指数"), indicator: optStringParam("全部/被动指数型/增强指数型") } },
  { endpoint: "fund_purchase_em", description: "东方财富-天天基金-基金申购/赎回状态", params: {} },

  { endpoint: "fund_open_fund_daily_em", description: "东方财富-天天基金-开放式基金实时净值", params: {} },
  { endpoint: "fund_open_fund_info_em", description: "东方财富-天天基金-开放式基金历史净值/收益/分红/拆分", params: { symbol: codeParam("基金代码, e.g. 270042"), indicator: optStringParam("单位净值走势/累计净值走势/累计收益率走势/同类排名走势/同类排名百分比/分红送配详情/拆分详情"), period: optStringParam("累计收益率走势周期: 1月/3月/6月/1年/3年/5年/今年来/成立来") } },
  { endpoint: "fund_money_fund_daily_em", description: "东方财富-天天基金-货币型基金实时收益", params: {} },
  { endpoint: "fund_money_fund_info_em", description: "东方财富-天天基金-货币型基金历史收益", params: { symbol: codeParam("基金代码, e.g. 000009") } },
  { endpoint: "fund_financial_fund_daily_em", description: "东方财富-天天基金-理财型基金实时数据", params: {} },
  { endpoint: "fund_financial_fund_info_em", description: "东方财富-天天基金-理财型基金历史净值", params: { symbol: codeParam("基金代码, e.g. 000134") } },
  { endpoint: "fund_graded_fund_daily_em", description: "东方财富-天天基金-分级基金实时数据", params: {} },
  { endpoint: "fund_graded_fund_info_em", description: "东方财富-天天基金-分级基金历史净值", params: { symbol: codeParam("基金代码, e.g. 150232") } },
  { endpoint: "fund_etf_fund_daily_em", description: "东方财富-天天基金-场内交易基金实时净值", params: {} },
  { endpoint: "fund_etf_fund_info_em", description: "东方财富-天天基金-场内交易基金历史净值", params: { fund: codeParam("基金代码, e.g. 511280"), start_date: optDateParam("Start date YYYYMMDD"), end_date: optDateParam("End date YYYYMMDD") } },
  { endpoint: "fund_hk_fund_hist_em", description: "东方财富-天天基金-香港基金历史净值/分红", params: { code: codeParam("香港基金代码, e.g. 1002200683"), symbol: optStringParam("历史净值明细/分红送配详情") } },

  { endpoint: "fund_open_fund_rank_em", description: "东方财富-开放式基金排行", params: { symbol: optStringParam("全部/股票型/混合型/债券型/指数型/QDII/FOF") } },
  { endpoint: "fund_exchange_rank_em", description: "东方财富-场内交易基金排行", params: {} },
  { endpoint: "fund_money_rank_em", description: "东方财富-货币型基金排行", params: {} },
  { endpoint: "fund_lcx_rank_em", description: "东方财富-理财基金排行", params: {} },
  { endpoint: "fund_hk_rank_em", description: "东方财富-香港基金排行", params: {} },
  { endpoint: "fund_individual_achievement_xq", description: "雪球-单只基金业绩详情", params: { symbol: codeParam("基金代码, e.g. 270042"), timeout: optNumberParam("Optional request timeout") } },
  { endpoint: "fund_individual_analysis_xq", description: "雪球-单只基金风险收益分析", params: { symbol: codeParam("基金代码, e.g. 270042"), timeout: optNumberParam("Optional request timeout") } },
  { endpoint: "fund_individual_profit_probability_xq", description: "雪球-单只基金盈利概率", params: { symbol: codeParam("基金代码, e.g. 270042"), timeout: optNumberParam("Optional request timeout") } },
  { endpoint: "fund_value_estimation_em", description: "东方财富-基金净值估算", params: { symbol: optStringParam("全部/股票型/混合型/债券型/指数型/QDII/ETF联接/LOF/场内交易基金") } },

  { endpoint: "fund_overview_em", description: "天天基金-基金档案-基本概况", params: { symbol: codeParam("基金代码, e.g. 270042") } },
  { endpoint: "fund_fee_em", description: "天天基金-基金档案-购买信息/费率", params: { symbol: codeParam("基金代码, e.g. 270042"), indicator: optStringParam("交易状态/申购与赎回金额/交易确认日/运作费用/认购费率（前端）/认购费率（后端）/申购费率（前端）/赎回费率") } },
  { endpoint: "fund_individual_detail_info_xq", description: "雪球-单只基金交易规则", params: { symbol: codeParam("基金代码, e.g. 270042"), timeout: optNumberParam("Optional request timeout") } },
  { endpoint: "fund_individual_detail_hold_xq", description: "雪球-单只基金指定季度大类资产持仓", params: { symbol: codeParam("基金代码, e.g. 270042"), date: dateParam("Quarter date YYYYMMDD, e.g. 20231231"), timeout: optNumberParam("Optional request timeout") } },
  { endpoint: "fund_portfolio_hold_em", description: "天天基金-基金股票持仓", params: { symbol: codeParam("基金代码, e.g. 270042"), date: yearParam("Year, e.g. 2025") } },
  { endpoint: "fund_portfolio_bond_hold_em", description: "天天基金-基金债券持仓", params: { symbol: codeParam("基金代码, e.g. 270042"), date: yearParam("Year, e.g. 2025") } },
  { endpoint: "fund_portfolio_industry_allocation_em", description: "天天基金-基金行业配置", params: { symbol: codeParam("基金代码, e.g. 270042"), date: yearParam("Year, e.g. 2025") } },
  { endpoint: "fund_portfolio_change_em", description: "天天基金-基金重大买入/卖出变动", params: { symbol: codeParam("基金代码, e.g. 270042"), indicator: stringParam("累计买入/累计卖出"), date: yearParam("Year, e.g. 2025") } },

  { endpoint: "fund_fh_em", description: "天天基金-基金分红", params: { year: yearParam("Year, e.g. 2026"), typ: optStringParam("Fund type filter"), rank: optStringParam("BZDM/ABBNAME/DJR/FSRQ/FHFCZ/FFR"), sort: optStringParam("asc/desc"), page: optIntegerParam("Page; -1 means all pages") } },
  { endpoint: "fund_cf_em", description: "天天基金-基金拆分", params: { year: yearParam("Year, e.g. 2026"), typ: optStringParam("Fund type filter"), rank: optStringParam("BZDM/ABBNAME/FSRQ/FHFCZ"), sort: optStringParam("asc/desc"), page: optIntegerParam("Page; -1 means all pages") } },
  { endpoint: "fund_fh_rank_em", description: "天天基金-基金累计分红排行", params: {} },
  { endpoint: "fund_etf_dividend_sina", description: "新浪财经-ETF基金累计分红", params: { symbol: stringParam("Sina fund symbol, e.g. sh510050") } },

  { endpoint: "fund_etf_spot_em", description: "东方财富-ETF实时行情", params: {} },
  { endpoint: "fund_etf_category_ths", description: "同花顺-基金每日净值实时行情", params: { symbol: optStringParam("股票型/债券型/混合型/ETF/LOF/QDII/保本型/指数型/empty for all"), date: optDateParam("Query date YYYYMMDD") } },
  { endpoint: "fund_etf_spot_ths", description: "同花顺-ETF基金实时行情", params: { date: optDateParam("Query date YYYYMMDD") } },
  { endpoint: "fund_lof_spot_em", description: "东方财富-LOF实时行情", params: {} },
  { endpoint: "fund_etf_category_sina", description: "新浪财经-基金列表及行情", params: { symbol: stringParam("封闭式基金/ETF基金/LOF基金") } },
  { endpoint: "fund_etf_hist_min_em", description: "东方财富-ETF分时行情", params: { symbol: codeParam("ETF代码, e.g. 513500"), start_date: optStringParam("Start datetime YYYY-MM-DD HH:mm:ss"), end_date: optStringParam("End datetime YYYY-MM-DD HH:mm:ss"), period: optStringParam("1/5/15/30/60"), adjust: optStringParam("empty/qfq/hfq") } },
  { endpoint: "fund_lof_hist_min_em", description: "东方财富-LOF分时行情", params: { symbol: codeParam("LOF代码, e.g. 166009"), start_date: optStringParam("Start datetime YYYY-MM-DD HH:mm:ss"), end_date: optStringParam("End datetime YYYY-MM-DD HH:mm:ss"), period: optStringParam("1/5/15/30/60"), adjust: optStringParam("empty/qfq/hfq") } },
  { endpoint: "fund_etf_hist_em", description: "东方财富-ETF历史行情", params: { symbol: codeParam("ETF代码, e.g. 513500"), period: optStringParam("daily/weekly/monthly"), start_date: optDateParam("Start date YYYYMMDD"), end_date: optDateParam("End date YYYYMMDD"), adjust: optStringParam("empty/qfq/hfq") } },
  { endpoint: "fund_lof_hist_em", description: "东方财富-LOF历史行情", params: { symbol: codeParam("LOF代码, e.g. 166009"), period: optStringParam("daily/weekly/monthly"), start_date: optDateParam("Start date YYYYMMDD"), end_date: optDateParam("End date YYYYMMDD"), adjust: optStringParam("empty/qfq/hfq") } },
  { endpoint: "fund_etf_hist_sina", description: "新浪财经-基金日频历史行情", params: { symbol: stringParam("Sina fund symbol, e.g. sh510050") } },
  { endpoint: "reits_realtime_em", description: "东方财富-沪深REITs实时行情", params: {} },
  { endpoint: "reits_hist_em", description: "东方财富-REITs历史行情", params: { symbol: codeParam("REITs code, e.g. 508097") } },

  { endpoint: "fund_rating_all", description: "天天基金-基金评级总汇", params: {} },
  { endpoint: "fund_rating_sh", description: "天天基金-上海证券评级", params: { date: dateParam("Rating date YYYYMMDD") } },
  { endpoint: "fund_rating_zs", description: "天天基金-招商证券评级", params: { date: dateParam("Rating date YYYYMMDD") } },
  { endpoint: "fund_rating_ja", description: "天天基金-济安金信评级", params: { date: dateParam("Rating date YYYYMMDD") } },
  { endpoint: "fund_manager_em", description: "天天基金-基金经理大全", params: {} },
  { endpoint: "fund_new_found_em", description: "天天基金-新成立基金", params: {} },
  { endpoint: "fund_new_found_ths", description: "同花顺-新发基金", params: { symbol: optStringParam("全部/发行中/将发行") } },

  { endpoint: "fund_scale_open_sina", description: "新浪财经-开放式基金规模", params: { symbol: stringParam("股票型基金/混合型基金/债券型基金/货币型基金/QDII基金") } },
  { endpoint: "fund_scale_close_sina", description: "新浪财经-封闭式基金规模", params: {} },
  { endpoint: "fund_scale_structured_sina", description: "新浪财经-分级子基金规模", params: {} },
  { endpoint: "fund_etf_scale_sse", description: "上交所-ETF基金份额", params: { date: dateParam("Date YYYYMMDD") } },
  { endpoint: "fund_etf_scale_szse", description: "深交所-ETF基金份额", params: {} },
  { endpoint: "fund_scale_daily_szse", description: "深交所-基金规模日频", params: { start_date: dateParam("Start date YYYYMMDD"), end_date: dateParam("End date YYYYMMDD"), symbol: stringParam("ETF/LOF/REITS") } },
  { endpoint: "fund_aum_em", description: "天天基金-基金公司规模详情", params: {} },
  { endpoint: "fund_aum_trend_em", description: "天天基金-市场全部基金规模走势", params: {} },
  { endpoint: "fund_aum_hist_em", description: "天天基金-基金公司历年管理规模", params: { year: yearParam("Year, e.g. 2025") } },
  { endpoint: "fund_scale_change_em", description: "天天基金-规模份额-规模变动", params: {} },
  { endpoint: "fund_hold_structure_em", description: "天天基金-规模份额-持有人结构", params: {} },

  { endpoint: "fund_report_stock_cninfo", description: "巨潮资讯-基金重仓股", params: { date: dateParam("Report date YYYYMMDD, quarter end") } },
  { endpoint: "fund_report_industry_allocation_cninfo", description: "巨潮资讯-基金行业配置", params: { date: dateParam("Report date YYYYMMDD, quarter end") } },
  { endpoint: "fund_report_asset_allocation_cninfo", description: "巨潮资讯-基金资产配置", params: {} },
  { endpoint: "fund_stock_position_lg", description: "乐咕乐股-股票型基金仓位", params: {} },
  { endpoint: "fund_balance_position_lg", description: "乐咕乐股-平衡混合型基金仓位", params: {} },
  { endpoint: "fund_linghuo_position_lg", description: "乐咕乐股-灵活配置型基金仓位", params: {} },

  { endpoint: "fund_announcement_dividend_em", description: "东方财富-天天基金-分红配送公告", params: { symbol: codeParam("基金代码, e.g. 270042") } },
  { endpoint: "fund_announcement_report_em", description: "东方财富-天天基金-定期报告公告", params: { symbol: codeParam("基金代码, e.g. 270042") } },
  { endpoint: "fund_announcement_personnel_em", description: "东方财富-天天基金-人事调整公告", params: { symbol: codeParam("基金代码, e.g. 270042") } },
];

export const AKSHARE_FUND_ENDPOINT_TOOLS: AgentTool[] = AKSHARE_FUND_ENDPOINT_SPECS.map(makeAkshareEndpointTool);

export const AKSHARE_FUND_ENDPOINT_TOOL_REGISTRATIONS: AkshareFundEndpointToolRegistration[] = AKSHARE_FUND_ENDPOINT_SPECS
  .map((spec) => ({ name: endpointToolName(spec.endpoint), label: endpointToolLabel(spec.endpoint) }));

export const AKSHARE_FUND_PREVIEW_FIELD_PRIORITY = [
  "基金代码",
  "代码",
  "基金简称",
  "简称",
  "基金名称",
  "名称",
  "字段",
  "item",
  "值",
  "value",
  "日期",
  "净值日期",
  "报告日期",
  "单位净值",
  "累计净值",
  "最新净值/万份收益",
  "日增长率",
  "增长率",
  "近1月",
  "近3月",
  "近6月",
  "近1年",
  "今年来",
  "申购状态",
  "赎回状态",
  "手续费",
  "基金类型",
  "类型",
  "基金经理",
  "基金公司",
  "周期",
  "本产品区间收益",
  "本产品最大回撒",
  "周期收益同类排名",
  "最新价",
  "涨跌幅",
  "成交额",
];

export function filterAkshareFundRows(rows: Record<string, unknown>[], args: Record<string, unknown>): Record<string, unknown>[] {
  const fundCode = textValue(args.fund_code);
  const keyword = textValue(args.keyword);
  return rows.filter((row) => {
    if (fundCode && !matchesFundCode(row, fundCode)) return false;
    if (keyword && !matchesKeyword(row, keyword)) return false;
    return true;
  });
}

function makeAkshareEndpointTool(spec: AkshareFundEndpointSpec): AgentTool {
  const parameters = Type.Object({ ...spec.params, ...COMMON_ENDPOINT_OPTIONS });
  return {
    name: endpointToolName(spec.endpoint),
    description: `Live AKShare public fund endpoint ${spec.endpoint}: ${spec.description}. No cache.`,
    label: endpointToolLabel(spec.endpoint),
    parameters,
    executionMode: "sequential",
    async execute(_id: string, rawArgs: unknown): Promise<AgentToolResult<unknown>> {
      const args = isRecord(rawArgs) ? rawArgs : {};
      const endpointParams = endpointArgs(spec, args);
      const data = await fetchAkshareRows(spec.endpoint, endpointParams);
      const filteredRows = filterAkshareFundRows(data.rows, args);
      const limit = outputLimit(args.limit, 12, 100);
      const rows = filteredRows.slice(0, limit);
      return ok(
        formatEndpointText(spec, data.rowCount, filteredRows.length, rows, endpointParams, args),
        {
          tool: endpointToolLabel(spec.endpoint),
          provider: "akshare",
          endpoint: spec.endpoint,
          params: endpointParams,
          fetchedAt: data.fetchedAt,
          rowCount: data.rowCount,
          filteredRowCount: filteredRows.length,
          rows,
        },
      );
    },
  };
}

function stringParam(description: string): TSchema {
  return Type.String({ description });
}

function optStringParam(description: string): TSchema {
  return Type.Optional(Type.String({ description }));
}

function codeParam(description: string): TSchema {
  return Type.String({ description });
}

function dateParam(description: string): TSchema {
  return Type.String({ description });
}

function optDateParam(description: string): TSchema {
  return Type.Optional(Type.String({ description }));
}

function yearParam(description: string): TSchema {
  return Type.String({ description });
}

function optIntegerParam(description: string): TSchema {
  return Type.Optional(Type.Integer({ description }));
}

function optNumberParam(description: string): TSchema {
  return Type.Optional(Type.Number({ description }));
}

function endpointToolName(endpoint: AksharePublicFundEndpoint): string {
  return `akshare_fund_${endpoint}`;
}

function endpointToolLabel(endpoint: AksharePublicFundEndpoint): string {
  return `Tool.akshare.fund.${endpoint}`;
}

function endpointArgs(spec: AkshareFundEndpointSpec, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(spec.params)) {
    const value = args[key];
    if (value != null && value !== "") out[key] = value;
  }
  return out;
}

function formatEndpointText(
  spec: AkshareFundEndpointSpec,
  rowCount: number,
  filteredRowCount: number,
  rows: Record<string, unknown>[],
  endpointParams: Record<string, unknown>,
  args: Record<string, unknown>,
): string {
  const lines = [
    `AKShare    ${spec.endpoint}`,
    `Tool       ${endpointToolLabel(spec.endpoint)}`,
    `Rows       ${filteredRowCount === rowCount ? rowCount : `${filteredRowCount} / ${rowCount}`}`,
  ];
  const paramLine = formatParams(endpointParams, args);
  if (paramLine) lines.push(`Params     ${paramLine}`);
  lines.push(...formatRecordPreview(rows, AKSHARE_FUND_PREVIEW_FIELD_PRIORITY, { maxFields: 7, cellMaxLength: 28 }));
  return lines.join("\n");
}

function formatParams(endpointParams: Record<string, unknown>, args: Record<string, unknown>): string {
  const entries = Object.entries({
    ...endpointParams,
    fund_code: args.fund_code,
    keyword: args.keyword,
    limit: args.limit,
  }).filter(([, value]) => value != null && value !== "");
  return entries.map(([key, value]) => `${key}=${String(value)}`).join("  ");
}

function matchesFundCode(row: Record<string, unknown>, fundCode: string): boolean {
  const target = normalizeCode(fundCode);
  for (const [key, value] of Object.entries(row)) {
    if (!/(基金代码|代码|证券代码|股票代码|债券代码|code|symbol)/i.test(key)) continue;
    const candidate = textValue(value);
    if (!candidate) continue;
    if (candidate === fundCode || normalizeCode(candidate) === target) return true;
  }
  return false;
}

function matchesKeyword(row: Record<string, unknown>, keyword: string): boolean {
  const lower = keyword.toLowerCase();
  return Object.values(row).some((value) => textValue(value).toLowerCase().includes(lower));
}

function normalizeCode(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits || value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
