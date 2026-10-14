import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { QuantAgentDependencies, QuantAgentSession } from "../../agent/src/session-contracts.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";
import type { ResearchState } from "../../research/state.ts";
import type { ResearchTaskSpec } from "../../types/research-task.ts";
import type { loadAnalysisBars } from "../data/analysis-data.ts";
import { archiveFundNav, loadCachedBars, saveBars } from "../../storage/index.ts";
import type { loadFundDcaData } from "../data/fund-data.ts";
import { normalizeFundNav } from "../../market/fund-nav.ts";
import { normalizeBarSeries, validateDateRange } from "../../market/bars.ts";
import { ResearchEvaluationAudit, type EvaluationPhase } from "./research-evaluation-audit.ts";
import { portfolioEvaluationCase } from "./research-evaluation-portfolio.ts";
import { EvaluationAnswers, isCompleteEvaluationAnswer } from "./evaluation-answers.ts";
import { knownFundAnswerViolations } from "../evidence/fund-answer-claims.ts";
import { matchingVerifiedFundOperations, verifiedFundMetrics } from "../evidence/fund-answer-evidence.ts";
import { knownFactorAnswerViolations } from "../evidence/factor-answer-claims.ts";
import { auditCurrentFactorAnswer } from "../evidence/factor-answer-evidence.ts";
import { auditCurrentPortfolioAnswer } from "../evidence/portfolio-answer-evidence.ts";
import { auditCurrentRiskAnswer } from "../evidence/risk-answer-evidence.ts";
import { parseRiskMetricClaims } from "../evidence/risk-answer-claims.ts";
import { factorEvaluationCase, FACTOR_EVALUATION_EXPECTATIONS } from "./research-evaluation-factors.ts";
import { hasAllFactorLatestClaims } from "../evidence/factor-latest-claims.ts";

export const RESEARCH_EVALUATION_CASES = ["stock", "index", "risk", "fund", "portfolio", "stock-factors"] as const;
export type ResearchEvaluationCase = typeof RESEARCH_EVALUATION_CASES[number];
export interface EvaluationFixture {
  id: ResearchEvaluationCase; symbol: string; symbols: string[]; start: string; end: string; market: "A" | "US";
  comparisonScope?: { groupIds: string[]; portfolioRevision: string; benchmark: string };
  prompt: string;
  required: Array<{ tool: string; parameters: Record<string, unknown>; metrics: string[] }>;
  expected: Array<{ tool: string; metric: string; value: number; parameters?: Record<string, unknown> }>;
}
export function researchEvaluationCase(id: ResearchEvaluationCase): EvaluationFixture {
  if (id === "stock-factors") return factorEvaluationCase();
  if (id === "portfolio") return portfolioEvaluationCase();
  if (id === "risk") {
    // 39 intervals: 10 each of +10%, -20%, +12.5%, and nine of +1/99.
    // The repeated peak 110 -> trough 88 gives -20%, with three observations below peak.
    const mean = (10 * (0.1 - 0.2 + 0.125) + 9 / 99) / 39;
    const annualVol = Math.sqrt((10 * ((0.1 - mean) ** 2 + (-0.2 - mean) ** 2 + (0.125 - mean) ** 2)
      + 9 * (1 / 99 - mean) ** 2) / 38 * 252);
    return { id, symbol: "AAPL", symbols: ["AAPL"], start: "2026-01-01", end: "2026-02-09", market: "US",
      prompt: "用本次归档的合成 AAPL 日线研究 2026-01-01 至 2026-02-09 的风险。先声明任务，验收年化波动率、下行波动率、历史 VaR 95%、CVaR 95%、最大回撤和最长回撤持续期，调用适用工具核验。解释单位、历史样本口径、适用条件和失效条件，不把 VaR 说成未来损失上限。不要增加因子、交易策略或观察截止，不扩大日期；只需文本，不生成报告，不推断真实市场或账户。",
      required: [{ tool: "check_risk", parameters: { symbol: "AAPL", start: "2026-01-01", end: "2026-02-09" },
        metrics: ["Annual volatility", "Downside volatility", "VaR 95%", "CVaR 95%", "Maximum drawdown", "Drawdown duration"] }],
      expected: [{ tool: "check_risk", metric: "Annual volatility", value: annualVol },
        { tool: "check_risk", metric: "Downside volatility", value: 0.2 * Math.sqrt(10 / 39 * 252) },
        { tool: "check_risk", metric: "VaR 95%", value: -0.2 }, { tool: "check_risk", metric: "CVaR 95%", value: -0.2 },
        { tool: "check_risk", metric: "Maximum drawdown", value: -0.2 }, { tool: "check_risk", metric: "Drawdown duration", value: 3 }],
    };
  }
  if (id === "fund") return {
    id, symbol: "270042.OF", symbols: ["270042.OF"], start: "2026-02-01", end: "2026-03-01", market: "A" as const,
    prompt: "用合成净值研究基金 270042.OF，2026-02-01 至 2026-03-01，每月 1 日投入 100，申购费率为 0（decimal）。先声明任务，验收本金收益率、时间加权收益率和剔除外部投入的最大回撤，调用工具核验，并解释三种口径、适用条件和失效条件。只需文本，不生成报告，不扩大日期或增加策略，不推断真实账户。",
    required: [{ tool: "fund_dca_backtest", parameters: { symbol: "270042", start_date: "2026-02-01", end_date: "2026-03-01",
      frequency: "monthly", invest_amount: 100, invest_day: 1, purchase_fee_rate: 0, purchase_fee_unit: "decimal" },
      metrics: ["Principal return", "Time-weighted return", "Maximum drawdown (TWR)"] }],
    expected: [{ tool: "fund_dca_backtest", metric: "Principal return", value: 0.25 },
      { tool: "fund_dca_backtest", metric: "Time-weighted return", value: 0.5 }, { tool: "fund_dca_backtest", metric: "Maximum drawdown (TWR)", value: 0 }],
  };
  const symbol = id === "stock" ? "AAPL" : "000300.SH", start = "2026-01-01", end = "2026-02-09";
  const parameters = { symbol, start, end };
  return { id, symbol, symbols: [symbol], start, end, market: id === "stock" ? "US" as const : "A" as const,
    prompt: `用合成观察研究 ${symbol}，${start} 至 ${end}，momentum 周期 2。先声明任务，验收最新动量值、年化波动率和最大回撤，调用工具核验，并说明结论的依据、适用条件和失效条件。样本是在本次评测运行时才归档的；价格日期不是应用观测时间，没有该历史窗口内的观测截止存档，请勿设置 observed_before。只需文本，不生成报告，不扩大日期或增加交易策略。`,
    required: [{ tool: "compute_factor", parameters: { ...parameters, factor: "momentum", period: 2 }, metrics: ["Latest"] },
      { tool: "check_risk", parameters, metrics: ["Annual volatility", "Maximum drawdown"] }],
    expected: [{ tool: "compute_factor", metric: "Latest", value: 139 / 137 - 1 }, { tool: "check_risk", metric: "Maximum drawdown", value: 0 }] };
}

/** Isolated fixture transport, actual data references and original quant calculations. No provider fallback. */
export function createEvaluationPriceData(id: "stock" | "index" | "risk" | "stock-factors"): typeof loadAnalysisBars {
  const fixture = researchEvaluationCase(id);
  const bars = Array.from({ length: 40 }, (_, index) => {
    const close = id === "risk" ? [100, 110, 88, 99][index % 4]! : id === "stock-factors" && index === 39 ? 124 : 100 + index;
    return { date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open: close, high: close, low: close, close, volume: 10, amount: 1000 };
  });
  return async (symbol, _minimum, start, end, signal) => {
    signal?.throwIfAborted(); validateDateRange(start, end);
    if (symbol !== fixture.symbol || start !== fixture.start || end !== fixture.end) throw new Error("Evaluation observations only cover the requested canonical symbol and exact dates; no live fallback.");
    const cached = await loadCachedBars(symbol, "financial-datasets", start, end);
    const dataset = cached.dataset && isDeepStrictEqual(cached.bars, bars)
      ? cached.dataset : await saveBars(symbol, "financial-datasets", bars, start, end, signal);
    signal?.throwIfAborted();
    return { bars: normalizeBarSeries(bars, start, end), source: "financial-datasets", origin: "cache", asOfDate: fixture.end, attempts: [], ...(dataset ? { dataset } : {}) };
  };
}

/** Public-NAV fixture with an actual immutable archive; no fees/provider fallback. */
export function createEvaluationFundData(): typeof loadFundDcaData {
  const nav = normalizeFundNav("270042.OF", [["2026-01-01", 1], ["2026-02-01", 0.5], ["2026-03-01", 0.75]].map(([date, value]) => ({
    fundCode: "270042", navDate: String(date), unitNav: Number(value), accumulatedNav: Number(value), dailyReturnPct: null,
    isOpenDay: true, source: "akshare:fund_open_fund_info_em",
  })));
  return async (symbol, observeFee, signal) => {
    signal?.throwIfAborted();
    if (!["270042", "270042.OF"].includes(symbol) || observeFee) throw new Error("Evaluation NAV only covers 270042.OF with an explicit fee assumption; no live fallback.");
    const dataset = await archiveFundNav("270042.OF", nav, "fund_open_fund_info_em", "2026-04-01T00:00:00.000Z", null, signal);
    return { symbol: "270042.OF", nav: structuredClone(nav), dataset, fee: null, purchase: {}, attempts: [] };
  };
}

export interface ResearchEvaluationCheck { name: string; passed: boolean }
export function checkResearchEvaluation(id: ResearchEvaluationCase, state: ResearchState): ResearchEvaluationCheck[] {
  const fixture = researchEvaluationCase(id), task = state.task;
  const verifiedFundOperations = id === "fund" ? matchingVerifiedFundOperations(state, fixture.required[0]!.parameters) : [];
  // The explicit benchmark may be included among scoped instruments; it is checked separately below.
  const symbols = task?.spec.scope.symbols.filter(symbol => symbol !== fixture.comparisonScope?.benchmark).sort();
  return [
    { name: "original request and exact scope", passed: task?.spec.request === fixture.prompt && isDeepStrictEqual(symbols, [...fixture.symbols].sort())
      && task.spec.scope.market === fixture.market && task.spec.scope.start === fixture.start && task.spec.scope.end === fixture.end && !task.spec.reportRequired
      && (!fixture.comparisonScope || Object.entries(fixture.comparisonScope).every(([key, value]) => isDeepStrictEqual(task.spec.scope[key as keyof typeof task.spec.scope], value))) },
    { name: "required criteria retained", passed: fixture.required.every(required => required.metrics.every(label => task?.spec.criteria.some(criterion => criterion.tool === required.tool
      && Object.entries(required.parameters).every(([key, value]) => isDeepStrictEqual(criterion.parameters[key], value)
        || id === "fund" && key === "symbol" && criterion.parameters[key] === "270042.OF"
        || id === "portfolio" && (key === "group_a" && criterion.parameters[key] === "Core" || key === "group_b" && criterion.parameters[key] === "Stable")
        || id === "portfolio" && key === "missing_members" && criterion.parameters[key] === undefined)
      && criterion.metrics.includes(label)))) },
    { name: "verified task complete without unresolved attempts", passed: task?.status === "complete" && !state.taskErrors.length && !state.unresolved.length },
    { name: "independent arithmetic expectations", passed: id === "fund"
      ? verifiedFundOperations.length > 0 && verifiedFundOperations.every(operation => fixture.expected.every(expected =>
        operation.findings?.metrics.some(metric => metric.label === expected.metric && metric.value !== null && Math.abs(metric.value - expected.value) < 1e-10)))
      : fixture.expected.every(expected => state.operations.some(operation => operation.tool === expected.tool
        && operation.status === "verified" && (!expected.parameters || Object.entries(expected.parameters).every(([key, value]) => isDeepStrictEqual(operation.parameters[key], value)))
        && operation.findings?.metrics.some(metric => metric.label === expected.metric && metric.value !== null && Math.abs(metric.value - expected.value) < 1e-10))) },
  ];
}

export interface ResearchEvaluationOptions { timeoutMs?: number; maxRequests?: number; signal?: AbortSignal }

/** Normal Quant Agent, including its production prompts. Mechanistic checks plus retained answers for human review. */
export async function runResearchEvaluation(id: ResearchEvaluationCase, dependencies: QuantAgentDependencies, options: ResearchEvaluationOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000, maxRequests = options.maxRequests ?? 12;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000 || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 50) throw new Error("Invalid evaluation limits");
  const fixture = researchEvaluationCase(id), connection = dependencies.readConnection();
  const startedAt = new Date().toISOString(), started = performance.now();
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let limited = false, requests = 0, inputTokens = 0, outputTokens = 0;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let agent: QuantAgentSession = createQuantResearchAgent({ dependencies });
  const completion = new EvaluationAnswers();
  const toolCalls = new Map<string, Record<string, unknown>>();
  const toolFailures: Array<{ tool: string; arguments: Record<string, unknown> | undefined; message: string }> = [];
  const audit = new ResearchEvaluationAudit();
  let phase: EvaluationPhase = "research";
  const attach = () => agent.subscribe(async event => {
    completion.observe(event);
    await audit.observe(event, agent, phase);
    if (event.type === "before_provider_request") {
      if (requests >= maxRequests) { limited = true; controller.abort(); } else requests++;
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      inputTokens += event.message.usage.input; outputTokens += event.message.usage.output;
      for (const part of event.message.content) if (part.type === "toolCall") toolCalls.set(`${phase}/${part.id}`, structuredClone(part.arguments));
    }
    if (event.type === "message_end" && event.message.role === "toolResult" && event.message.isError) {
      toolFailures.push({ tool: event.message.toolName, arguments: toolCalls.get(`${phase}/${event.message.toolCallId}`),
        message: event.message.content.filter(part => part.type === "text").map(part => part.text).join("\n") });
    }
  });
  let unsubscribe = attach();
  let taskBeforeRecovery: ResearchTaskSpec | null = null, checks: ResearchEvaluationCheck[] = [], outcome = "finished";
  try {
    await agent.prompt(fixture.prompt, { signal }); signal.throwIfAborted();
    let state = await agent.getResearchState(); checks = checkResearchEvaluation(id, state);
    taskBeforeRecovery = state.task?.spec ?? null;
    completion.finish(!!agent.state.errorMessage);
    if (checks.every(check => check.passed)) {
      const metadata = await agent.getSessionMetadata();
      if (!metadata) throw new Error("Missing evaluation session");
      const before = structuredClone(state.task), operations = state.operations.length;
      const stored = await dependencies.sessions.open(metadata);
      const tail = await stored.appendMessage({ role: "user", content: "之后继续原研究", timestamp: 0 });
      await stored.appendCompaction("Earlier research details omitted deliberately for the recovery evaluation.", tail, 50000);
      unsubscribe(); phase = "recovery"; agent = createQuantResearchAgent({ dependencies }); unsubscribe = attach();
      await agent.resumeSession(metadata.id);
      completion.begin("recovery");
      await agent.prompt("刚才研究的标的、日期、验收条件和数值依据是什么？从已有证据恢复，不重新计算或改变任务。", { signal }); signal.throwIfAborted();
      state = await agent.getResearchState();
      checks.push({ name: "lossy recovery preserves task and avoids recomputation", passed: isDeepStrictEqual(state.task, before) && state.operations.length === operations });
      completion.finish(!!agent.state.errorMessage);
    }
    if (agent.state.errorMessage) outcome = "request-failed";
  } catch { outcome = signal.aborted ? options.signal?.aborted ? "cancelled" : limited ? "request-limit" : "timeout" : "request-failed"; }
  finally { clearTimeout(timer); agent.abort(); await agent.waitForIdle(); completion.finish(!!agent.state.errorMessage); unsubscribe(); }
  const state = await agent.getResearchState();
  // A timeout may occur after tools committed evidence but before the final answer.
  if (!checks.length) checks = checkResearchEvaluation(id, state);
  const answers = completion.answers;
  const answerMetrics = id === "fund" ? verifiedFundMetrics(state, fixture.required[0]!.parameters) : null;
  const knownClaimViolations = answers.flatMap(answer => {
    let codes: string[];
    if (id === "fund") codes = knownFundAnswerViolations(answer.text, answerMetrics ?? undefined);
    else if (id === "risk") {
      const risk = auditCurrentRiskAnswer(state, answer.text);
      codes = risk.status === "audited" ? risk.violations : ["risk-evidence-unavailable"];
    }
    else if (id === "stock" || id === "index" || id === "stock-factors") {
      const factor = auditCurrentFactorAnswer(state, answer.text);
      const risk = auditCurrentRiskAnswer(state, answer.text);
      codes = [...(factor.status === "audited" ? factor.violations : [
        ...knownFactorAnswerViolations(answer.text), ...(factor.status === "unavailable" ? ["factor-evidence-unavailable"] : [])]),
        ...(risk.status === "audited" ? risk.violations : risk.status === "unavailable" ? ["risk-evidence-unavailable"] : [])];
    }
    else {
      const result = auditCurrentPortfolioAnswer(state, answer.text);
      codes = result.status === "audited" ? result.violations : result.status === "unavailable" ? ["portfolio-evidence-unavailable"] : [];
    }
    return codes.map(code => ({ phase: answer.phase, code }));
  });
  checks.push(...answers.map(answer => ({ name: `${answer.phase}: nonempty normally completed answer retained for semantic review`, passed: isCompleteEvaluationAnswer(answer) })));
  if (id === "risk") checks.push(...answers.map(answer => ({ name: `${answer.phase}: all six risk metrics explicitly quoted`,
    passed: new Set(parseRiskMetricClaims(answer.text, fixture.symbol).map(claim => claim.metric)).size === 6 })));
  if (id === "stock-factors") checks.push(...answers.map(answer => ({ name: `${answer.phase}: all six factor Latest values explicitly quoted with periods`,
    passed: hasAllFactorLatestClaims(answer.text, FACTOR_EVALUATION_EXPECTATIONS) })));
  if (outcome === "finished" && completion.failure) outcome = completion.failure;
  return { version: 1, kind: "research-model-evaluation", case: id, startedAt, completedAt: new Date().toISOString(), durationMs: performance.now() - started,
    config: { provider: connection.model.provider, model: connection.model.id, api: connection.model.api, thinking: connection.thinkingLevel,
      endpointHash: createHash("sha256").update(connection.model.baseUrl).digest("hex"), systemPromptHash: createHash("sha256").update(agent.state.systemPrompt).digest("hex"),
      toolNames: agent.state.tools.map(tool => tool.name), toolNamesScope: "host-enabled", systemPromptHashScope: "facade-state", timeoutMs, maxRequests },
    prompt: fixture.prompt, fixture: id === "fund" ? { kind: "synthetic-fund-nav", observations: "Jan 1: 1; Feb 1: 0.5; Mar 1: 0.75. Only Feb/Mar invested, 100 each, zero fee.", liveMarketAccess: false }
      : id === "portfolio" ? { kind: "synthetic-portfolio-prices", observations: "Core/AAPL 100..139; Stable/MSFT constant 100; SPY 100..119.5; 40 calendar dates, USD identity FX.", liveMarketAccess: false }
      : id === "risk" ? { kind: "synthetic-drawdown-observations", closes: "Ten repeats of 100,110,88,99; 40 consecutive calendar dates, 39 intervals", liveMarketAccess: false }
      : id === "stock-factors" ? { kind: "synthetic-six-factor-observations", closes: "100 through 138, then 124; volume 10; 40 consecutive calendar dates", liveMarketAccess: false }
      : { kind: "synthetic-daily-observations", closes: "100 through 139, consecutive calendar dates", liveMarketAccess: false },
    outcome, requests, usage: { inputTokens, outputTokens }, checks,
    knownClaimViolations, verifiedAnswerMetrics: answerMetrics, passed: outcome === "finished" && checks.length === (id === "risk" || id === "stock-factors" ? 9 : 7) && answers.length === 2
      && (id !== "fund" || answerMetrics !== null)
      && checks.every(check => check.passed) && knownClaimViolations.length === 0,
    taskBeforeRecovery, task: state.task, taskErrors: state.taskErrors, toolFailures,
    audit: { version: 1, preparedRequests: audit.preparedRequests, toolTrace: audit.toolTrace, checkpoints: audit.checkpoints },
    operations: state.operations.map(operation => ({ tool: operation.tool, parameters: operation.parameters, status: operation.status, reason: operation.reason, findings: operation.findings })),
    answers, reviewRequired: "Known fund/factor/risk/portfolio claim contradictions are a regression gate. Human review is still required for explanation, conditions, other unsupported claims and recovery answer." };
}
