import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ResearchEntry, ResearchState } from "../research/state.ts";
import { initialResearchTaskRevision, researchTaskAction } from "../research/task-actions.ts";
import { validatePortfolioTaskDeclaration } from "../research/task-portfolio-scope.ts";
import { record } from "../research/references.ts";
import { RESEARCH_ACCEPTANCE_TOOLS, validateResearchTaskEvent } from "../research/tasks.ts";
import { PRICE_RESEARCH_METRICS } from "../research/analysis.ts";
import { FUND_RESEARCH_METRICS } from "../research/fund.ts";
import { researchMetricsForModel } from "../research/metrics.ts";
import { comparisonMetricLabels } from "../research/comparison-metrics.ts";
import { normalizeSymbol } from "../market/symbols.ts";
import { DEFAULT_BENCHMARK_SYMBOL } from "../quant/index.ts";
import { ok } from "./shared/results.ts";

const text = Type.String({ minLength: 1 });
const strings = Type.Array(text, { uniqueItems: true });
const attempt = Type.Object({ callEntryId: text, callId: text }, { additionalProperties: false });
const parameters = Type.Object({ action: Type.Union([Type.Literal("read"), Type.Literal("declare"), Type.Literal("resolve"), Type.Literal("cancel")]),
  benchmark: Type.Optional(Type.String({ minLength: 1, description: "For read only: optional benchmark for exact comparison metric labels before declaration. Otherwise uses the current task benchmark, if any. Does not change the task or fetch data." })),
  expectedRevision: Type.Optional(Type.String({ minLength: 1, description: "Required for declare/resolve/cancel. Copy the exact string expectedRevision from the latest read result. Do not construct or omit it." })),
  requestEntryId: Type.Optional(Type.String({ minLength: 1, description: "For declare, copy requestEntryId from the latest read result." })),
  task: Type.Optional(Type.Object({ id: Type.Optional(Type.String({ minLength: 1, description: "Optional on the first declaration only: omit to let the host assign a stable study ID from the original user request entry. For revisions, copy the same task.id from read." })), goal: text,
    scope: Type.Object({ symbols: Type.Array(text, { minItems: 1, uniqueItems: true }), market: Type.Union([Type.Literal("A"), Type.Literal("US"), Type.Literal("HK"), Type.Literal("mixed")]),
      start: text, end: text, benchmark: Type.Optional(text),
      portfolioRevision: Type.Optional(Type.String({ minLength: 1, description: "Required for a new compare_portfolios task. Copy the exact revision from list_portfolios or the selected saved comparison into this scope field. Reading a revision alone does not pin the task. Preserve an explicitly requested version; never invent one." })),
      groupIds: Type.Optional(strings) }, { additionalProperties: false }),
    constraints: Type.Object({ allowedTools: strings, notes: strings }, { additionalProperties: false }),
    dataRefs: Type.Array(Type.Object({ kind: Type.Union([Type.Literal("daily-bars"), Type.Literal("fund-nav")]), symbol: text, revision: text, contentHash: text }, { additionalProperties: false }),
      { description: "Optional version pins. Use [] when no actual source references are supplied or observed yet. Copy revision/contentHash from real tool evidence or an explicit user-supplied reference; never invent placeholder versions." }),
    criteria: Type.Array(Type.Object({ id: text, description: text,
      tool: Type.Union(RESEARCH_ACCEPTANCE_TOOLS.map(name => Type.Literal(name)), { description: "Supported quant evidence verifier. A shell read or supplied narrative is not a verified calculation; never invent an acceptance tool." }),
      parameters: Type.Record(Type.String(), Type.Unknown()), metrics: strings }, { additionalProperties: false }), { minItems: 1 }),
    reportRequired: Type.Boolean(),
  }, { additionalProperties: false })),
  from: Type.Optional(attempt), to: Type.Optional(attempt), reason: Type.Optional(text),
}, { additionalProperties: false });

export const RESEARCH_TASK_GUIDANCE = `
Research task workflow:
- Use research_task read to inspect the current goal, revision, latest requestEntryId, criteria, evidence and unresolved attempts.
- For a research request with clear instruments and dates, declare its goal and verifiable acceptance before calculations, in a separate tool turn. Ask only for missing inputs; do not invent dates, currencies, fees or goals. Informational questions do not need a task.
- A supplied-material interpretation or read-only skill workflow does not need a new quant task merely because it mentions symbols, dates or risk. Follow its permitted evidence mode and output sections. Do not fabricate an acceptance tool for narrative facts, turn a workflow file read into verified financial evidence, or add unrelated calculations to obtain a completed task. Leave an existing task unchanged and respect its constraints.
- Read exposes acceptanceTools: the currently enabled tools with supported quant evidence verifiers, separately from metricLabels. Registration does not prove dependencies or data readiness. If none match the requested calculation, explain the missing verification capability; do not claim verified completion.
- A declaration copies requestEntryId and the string expectedRevision from read. On the first undeclared study, task.id may be omitted; the host assigns a stable ID from the original user request entry. If you provide an ID, use a nonempty stable value. For a revision, copy the existing task.id from read. The host binds the original user text and checks the observed state; choose a new ID for a new study.
- dataRefs pins specific observed or user-supplied versions. Before data is available, declare dataRefs as [] rather than fabricating a version or hash; later calculations still require matching archived evidence. Preserve explicit user pins: a mismatch is a blocker, not permission to replace them. Do not rerun already verified identical calculations merely to fill an optional pin or claim progress.
- Allowed tools must cover the necessary calculations and data. Each criterion must include the full planned tool-call parameters, including chosen dates, capital, fees and other assumptions; extra fields in the eventual call also prevent a match. For price, fund DCA and portfolio comparison tools, read metricLabels before declaring acceptance; these are the exact labels used by verification. For benchmark metrics before declaration, supply the requested benchmark to read. Other tools use their verified result labels. Do not weaken criteria or widen scope merely to claim completion. On continuation, preserve the original scope and criteria unless the user changes them.
- For score_benchmark, pass task.scope.benchmark explicitly as benchmark_symbol when one is declared. Omitting it uses ${DEFAULT_BENCHMARK_SYMBOL}; a different benchmark cannot satisfy the declared task even if it is also listed among task symbols.
- A show_dashboard result may combine saved scores with different benchmarks. If the task declares one benchmark, the full verified cohort must use it; the displayed top ten alone is not sufficient evidence. Without a declared benchmark, verified comparison benchmarks need not appear among task.scope.symbols, but every strategy instrument still must.
- Pass the declared window using the exact date parameter names in each selected tool's schema. Factor warmup is inside the declared window. Task fund identities use .OF; a fund DCA tool may also accept the corresponding bare six-digit code as documented in its schema or description.
- Portfolio metrics are qualified by series, e.g. "Portfolio A / Total return", "Portfolio B / Max drawdown" or "Benchmark · SPY / Total return". Bare "Total return" is ambiguous for a comparison. New compare_portfolios declarations require task.scope.groupIds and task.scope.portfolioRevision: copy the read version and selected IDs in comparison order before calculating; merely reading or mentioning a version does not bind the declaration. Preserve this scope on continuation. Group revision/identity constraints apply to comparison results, not separate member calculations. Each comparison criterion uses the complete comparison parameters, including benchmark and the full member/benchmark currency map, even when it requires metrics for only one series.
- A successful mutation result records the event; read again to obtain its persisted revision. Do not treat a prepared update, assistant stop or narrative claim as completed research.
- Acceptance is computed automatically from matching verified evidence; resolve cannot mark a criterion complete. Link a failed attempt only to a later independently verified retry with identical full parameters using resolve; never hide a failure or link a different calculation.
- Cancel only when the user asks to end the task. A cancelled task remains readable; declare again on an explicit request to resume. Report requirements refer to Auto Artifacts, which is configured by the user in /config.
- Show the declared goal, scope, acceptance statuses, missing evidence and report reference in plain text. The task event is local session metadata, not an order, permission grant or arbitrary executable policy.
`;

/** Session-bound control tool, composed by Quant Harness rather than the static data registry. */
export function createResearchTaskTool(read: () => Promise<{ state: ResearchState; entries: ResearchEntry[] }>): AgentTool {
  return { name: "research_task", label: "Quant.Research", parameters, executionMode: "sequential",
    description: "Read or declare a research task, link a verified retry, or cancel a user-requested task. Read first for revision/requestEntryId. Declare task omits request: the host preserves the original user text. Criteria use verified quant tools and exact metric labels. No provider calls, portfolio edits, orders or duplicate Agent loop. A successful mutation is committed as its tool result; read again for the new revision.",
    async execute(_id, input: unknown, signal) {
      signal?.throwIfAborted();
      const { state, entries } = await read();
      signal?.throwIfAborted();
      const latestRequest = state.requests.at(-1) ?? null;
      const expectedRevision = state.task?.revision ?? (latestRequest ? initialResearchTaskRevision(latestRequest.entryId) : null);
      const action = record(input);
      if (action?.benchmark !== undefined && action.action !== "read") throw new Error("benchmark is only for read-time metric discovery; declarations use task.scope.benchmark.");
      if (action?.action !== "read" && (typeof action?.expectedRevision !== "string" || action.expectedRevision !== expectedRevision)) {
        throw new Error("Stale or invalid task revision. Read the current task and copy its expectedRevision string exactly.");
      }
      const event = researchTaskAction(input, state.requests);
      if (event) {
        validatePortfolioTaskDeclaration(event, state.operations);
        const next = validateResearchTaskEvent(event, entries, state.operations, state.availableTools);
        signal?.throwIfAborted();
        return ok(`Research task ${event.type}: ${next.spec.goal}\nScope: ${next.spec.scope.symbols.join(", ")} · ${next.spec.scope.start} to ${next.spec.scope.end}\n`
          + `Acceptance: ${next.spec.criteria.map(item => `${item.id}: ${item.description} (${item.tool}; ${item.metrics.join(", ")})`).join("; ")}\n`
          + "Event prepared for this tool result. Read the task after persistence for its revision and verified status.", { event });
      }
      const task = state.task;
      const requestedBenchmark = action?.benchmark ?? task?.spec.scope.benchmark;
      if (requestedBenchmark !== undefined && (typeof requestedBenchmark !== "string" || !/^[A-Z0-9^.\-]{1,24}$/i.test(requestedBenchmark))) throw new Error("Invalid benchmark for metric discovery.");
      const metricLabelBenchmark = requestedBenchmark === undefined ? undefined : normalizeSymbol(requestedBenchmark);
      const portfolioLabels = comparisonMetricLabels(metricLabelBenchmark);
      const archivedLabels = [...new Set(["compute_factor", "run_backtest", "check_risk"].flatMap(name =>
        Object.values(PRICE_RESEARCH_METRICS[name as "compute_factor" | "run_backtest" | "check_risk"])))];
      const metricLabels = Object.fromEntries(Object.entries({
        ...Object.fromEntries(Object.entries({ ...PRICE_RESEARCH_METRICS, fund_dca_backtest: FUND_RESEARCH_METRICS }).map(([name, labels]) => [name, Object.values(labels)])),
        analyze_archived_bars: archivedLabels,
        compare_portfolios: portfolioLabels, portfolio_comparisons: portfolioLabels,
      }).filter(([name]) => state.availableTools.includes(name)));
      const acceptanceTools = RESEARCH_ACCEPTANCE_TOOLS.filter(name => state.availableTools.includes(name));
      const data = { task, expectedRevision, requestEntryId: latestRequest?.entryId ?? null, acceptanceTools,
        metricLabels, metricLabelBenchmark,
        taskErrors: state.taskErrors, latestRequest, availableTools: state.availableTools,
        operations: state.operations.map(operation => ({ callEntryId: operation.callEntryId, callId: operation.callId, resultEntryId: operation.resultEntryId,
          tool: operation.tool, parameters: operation.parameters, status: operation.status, reason: operation.reason,
          findings: operation.findings ? { ...operation.findings, metrics: researchMetricsForModel(operation.findings.metrics) } : undefined })),
        unresolved: state.unresolved, reports: state.reports };
      const summary = task ? [`Research task: ${task.spec.goal}`, `Status: ${task.status} · Revision: ${task.revision}`,
        `Scope: ${task.spec.scope.symbols.join(", ")} · ${task.spec.scope.start} to ${task.spec.scope.end}`,
        ...task.criteria.map(item => `${item.id}: ${item.status} · ${item.reason}`), ...task.reasons,
        `Report: ${task.reportRef ?? (task.spec.reportRequired ? "required, missing" : "not required")}`,
        ...(task.reportRef ? [`Report available: ${task.reportAvailable === null ? "unchecked" : task.reportAvailable}`] : [])].join("\n")
        : acceptanceTools.length ? "No declared research task. Resolve the object, dates and acceptance before calculations; supplied-material interpretation does not require a quant declaration."
          : "No declared research task. No enabled quant acceptance tools. A supplied-material interpretation may follow its permitted evidence mode without declaring a quant task or claiming verified financial results.";
      return ok(`${summary}\nTask details: ${JSON.stringify(data)}`, data);
    },
  };
}
