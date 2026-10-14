import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { QuantAgentDependencies, QuantAgentSession } from "../../agent/src/session-contracts.ts";
import type { PortfolioComparisonArtifact } from "../../types/portfolio-comparison.ts";
import type { AnnualReportArtifact } from "../../types/annual-report.ts";
import { loadAnnualReport } from "../../storage/index.ts";
import { record } from "../../research/references.ts";
import { verifyAnnualResearch } from "../../research/annual.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";
import { listAnnualReports } from "../research/annual-reports.ts";
import { readResearchDecisions, recordResearchDecision } from "../research/research-decisions.ts";
import { ResearchEvaluationAudit, type EvaluationPhase } from "./research-evaluation-audit.ts";
import type { ResearchEvaluationOptions } from "./research-evaluation.ts";
import { EvaluationAnswers, isCompleteEvaluationAnswer } from "./evaluation-answers.ts";
import { performanceMethodClaimViolations } from "../evidence/performance-method-claims.ts";
import { comparisonExcessClaimViolations } from "../evidence/comparison-answer-methods.ts";

export const ANNUAL_EVALUATION_TOOLS = ["portfolio_comparisons", "research_decisions", "annual_report", "annual_reports"] as const;

/** Caller creates this known four-observation comparison in an isolated workspace. */
export function createAnnualEvaluationFixture(source: PortfolioComparisonArtifact) {
  const selected = recordResearchDecision({ requestId: "annual-evaluation-selected", comparisonId: source.id, declaredDate: "2025-06-30", choice: "defer",
    rationale: "合成补录：样本很少，暂缓调整研究方案，等待更多证据。本条不是实际成交或用户批准。" });
  const other = recordResearchDecision({ requestId: "annual-evaluation-unselected", comparisonId: source.id, declaredDate: "2025-12-31", choice: "revise",
    rationale: "另一项合成研究声明，仅因日期较新不能自动纳入本次年报。" });
  const args = { comparison_id: source.id, year: 2025, valuation_cutoff: "2025-12-31", decision_ids: [selected.decision.id] };
  return { comparisonId: source.id, selected, other, args,
    prompt: `使用保存的合成比较 ${source.id} 生成 2025 年度研究报告，截止 2025-12-31，仅纳入决策 ${selected.decision.id}。先读取比较与选定决策，核对范围再生成；不要自动选入其他记录，不修改组合或新增决策，不声明结构化任务，不获取行情。解释两组及基准收益、样本覆盖、决策声明日期与实际记录时间、费用与账户边界。保留报告 ID、HTML 路径和选定决策 ID，回答不超过 800 汉字。` };
}
export type AnnualEvaluationFixture = ReturnType<typeof createAnnualEvaluationFixture>;

/** Fixed input and actual tools; automatic bindings and retained answers are separate evidence. */
export async function runAnnualEvaluation(fixture: AnnualEvaluationFixture, dependencies: QuantAgentDependencies, options: ResearchEvaluationOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 240_000, maxRequests = options.maxRequests ?? 12;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000 || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 50) throw new Error("Invalid evaluation limits");
  if (!isDeepStrictEqual(dependencies.tools.map(tool => tool.name).sort(), [...ANNUAL_EVALUATION_TOOLS].sort()) || dependencies.readTools) throw new Error("Annual evaluation requires exactly the isolated annual tools and no dynamic registry.");
  const startedAt = new Date().toISOString(), started = performance.now(), connection = dependencies.readConnection();
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let agent: QuantAgentSession = createQuantResearchAgent({ dependencies }), phase: EvaluationPhase = "research";
  let requests = 0, limited = false, inputTokens = 0, outputTokens = 0, outcome = "finished";
  const audit = new ResearchEvaluationAudit(), completion = new EvaluationAnswers();
  const checks: Array<{ name: string; passed: boolean }> = [];
  const views = new Map<string, string>();
  let artifact: AnnualReportArtifact | null = null;
  const attach = () => agent.subscribe(async event => {
    completion.observe(event);
    await audit.observe(event, agent, phase);
    if (event.type === "before_provider_request") { if (requests >= maxRequests) { limited = true; controller.abort(); } else requests++; }
    if (event.type !== "message_end") return;
    if (event.message.role === "assistant") { inputTokens += event.message.usage.input; outputTokens += event.message.usage.output; }
    if (event.message.role === "toolResult" && !event.message.isError && ["annual_report", "annual_reports"].includes(event.message.toolName)) {
      const details = record(event.message.details);
      if (typeof details?.id === "string" && typeof details.path === "string") views.set(details.id, details.path);
    }
  });
  let unsubscribe = attach();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const capture = () => {
    const answer = completion.finish(!!agent.state.errorMessage), { text } = answer;
    if (checks.some(check => check.name.startsWith(`${answer.phase}:`))) return;
    checks.push({ name: `${answer.phase}: finished answer cites the report and selected decision for separate semantic review`,
      passed: isCompleteEvaluationAnswer(answer) && !!artifact && text.includes(artifact.id) && text.includes(fixture.selected.decision.id) });
  };
  try {
    await agent.prompt(fixture.prompt, { signal }); signal.throwIfAborted();
    const before = (await agent.getResearchState()).operations, generated = before.filter(operation => operation.tool === "annual_report" && operation.status === "recorded");
    checks.push({ name: "one report uses the exact comparison, year, cutoff and selected decision", passed: generated.length === 1 && isDeepStrictEqual(generated[0]?.parameters, fixture.args) });
    const generationIndex = generated[0] ? before.indexOf(generated[0]) : -1;
    checks.push({ name: "original comparison and selected decision were read before generation", passed: generationIndex >= 0
      && before.slice(0, generationIndex).some(operation => operation.tool === "portfolio_comparisons" && operation.status === "verified" && operation.parameters.id === fixture.comparisonId)
      && before.slice(0, generationIndex).some(operation => operation.tool === "research_decisions" && operation.status === "recorded" && operation.parameters.action === "read" && operation.parameters.id === fixture.selected.decision.id) });
    const id = generated[0]?.recordedScope?.id;
    if (typeof id === "string") artifact = loadAnnualReport(id);
    if (artifact) {
      const verified = verifyAnnualResearch(artifact.request), summary = listAnnualReports();
      checks.push({ name: "saved evidence and independent numeric expectations match", passed: summary.items.length === 1 && !summary.unavailable.length
        && verified.comparisonHash === artifact.comparisonHash && isDeepStrictEqual(artifact.decisionHashes, [{ id: fixture.selected.decision.id, hash: fixture.selected.hash }])
        && Math.abs(verified.source.result.groups[0].totalReturn - 0.2) < 1e-12 && Math.abs(verified.source.result.groups[0].maxDrawdown - (90 / 110 - 1)) < 1e-12
        && Math.abs(verified.source.result.groups[1].totalReturn - 0.1) < 1e-12 && Math.abs(verified.source.result.benchmark.totalReturn - 0.15) < 1e-12
        && verified.comparison.dates.length === 4 && artifact.html.includes("补录声明日期") && artifact.html.includes("真实账户业绩未接入") });
    } else checks.push({ name: "saved evidence and independent numeric expectations match", passed: false });
    const decisions = readResearchDecisions();
    checks.push({ name: "selected decision and existing journal remain unchanged", passed: !decisions.unavailable.length
      && isDeepStrictEqual(decisions.items, [fixture.selected, fixture.other]) && !before.some(operation => operation.tool === "research_decisions" && operation.parameters.action === "record") });
    capture();
    if (artifact) {
      const original = structuredClone(artifact), metadata = await agent.getSessionMetadata();
      if (!metadata) throw new Error("Missing annual evaluation session");
      const stored = await dependencies.sessions.open(metadata), tail = await stored.appendMessage({ role: "user", content: "稍后恢复这份年报", timestamp: 0 });
      await stored.appendCompaction("Annual report and decision details deliberately omitted for the recovery evaluation.", tail, 50000);
      const compacted = JSON.stringify((await stored.buildContext()).messages);
      checks.push({ name: "compacted model messages actually omit report and decision IDs", passed: !compacted.includes(artifact.id) && !compacted.includes(fixture.selected.decision.id) });
      unsubscribe(); phase = "recovery"; agent = createQuantResearchAgent({ dependencies }); unsubscribe = attach();
      await agent.resumeSession(metadata.id);
      completion.begin("recovery");
      await agent.prompt("恢复刚才那份年报，核对原始归档并返回原报告 ID、HTML 路径和选定决策 ID；不得生成新报告、新增或改选决策、重新取行情。解释原范围与数字，特别说明决策日期和记录时间是否代表历史当时已有依据，以及是否包含真实账户业绩。回答不超过 800 汉字。", { signal });
      signal.throwIfAborted(); capture();
      const after = (await agent.getResearchState()).operations, recovery = after.slice(before.length);
      checks.push({ name: "recovery preserves prior operations and restores the original report without new research records", passed: isDeepStrictEqual(after.slice(0, before.length), before)
        && recovery.some(operation => operation.tool === "annual_reports" && operation.status === "recorded" && operation.parameters.id === original.id)
        && recovery.every(operation => operation.tool === "annual_reports" || operation.tool === "portfolio_comparisons" || operation.tool === "research_decisions" && operation.parameters.action !== "record") });
      const path = views.get(original.id), reports = listAnnualReports();
      checks.push({ name: "original report and HTML bytes survive recovery; no report or decision appended", passed: isDeepStrictEqual(loadAnnualReport(original.id), original)
        && !!path && readFileSync(path, "utf8") === original.html && reports.items.length === 1 && !reports.unavailable.length
        && isDeepStrictEqual(readResearchDecisions(), { items: [fixture.selected, fixture.other], unavailable: [] }) });
    }
    if (agent.state.errorMessage) outcome = "request-failed";
  } catch { outcome = signal.aborted ? options.signal?.aborted ? "cancelled" : limited ? "request-limit" : "timeout" : "request-failed"; }
  finally { clearTimeout(timer); agent.abort(); await agent.waitForIdle(); capture(); unsubscribe(); }
  if (outcome === "finished" && completion.failure) outcome = completion.failure;
  const answers = completion.answers;
  const knownClaimViolations = answers.flatMap(answer => [...performanceMethodClaimViolations(answer.text), ...comparisonExcessClaimViolations(answer.text)]
    .map(code => ({ phase: answer.phase, code })));
  return { version: 1, kind: "annual-model-evaluation", case: "annual", startedAt, completedAt: new Date().toISOString(), durationMs: performance.now() - started,
    config: { provider: connection.model.provider, model: connection.model.id, api: connection.model.api, thinking: connection.thinkingLevel,
      endpointHash: createHash("sha256").update(connection.model.baseUrl).digest("hex"), toolNames: agent.state.tools.map(tool => tool.name), timeoutMs, maxRequests },
    fixture: { kind: "synthetic-annual-and-decisions", liveMarketAccess: false, ...fixture }, outcome, requests, usage: { inputTokens, outputTokens }, checks,
    knownClaimViolations, passed: outcome === "finished" && checks.length === 9 && checks.every(check => check.passed)
      && answers.length === 2 && knownClaimViolations.length === 0,
    artifact, audit, answers, operations: (await agent.getResearchState()).operations,
    reviewRequired: "Review both actual answers. Expected hypothetical A/B/benchmark returns: 20%/10%/15%, A excess: 5 percentage points, A observed drawdown: -18.1818%, only four common dates. Selected June 30 statement was recorded later and cites data through December 31; never treat it as contemporaneous approval, causal explanation, actual trading or full-year decision history. Fees/dividends and real account performance are not verified. Automatic bindings and citation IDs are not a semantic accuracy score. HTML paths belong to a temporary fixture; original HTML is retained in artifact." };
}
