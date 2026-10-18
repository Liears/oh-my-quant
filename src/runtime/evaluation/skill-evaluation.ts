import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { AgentTool } from "../../agent/src/session-runtime/index.ts";
import type { QuantAgentDependencies, QuantAgentSession } from "../../agent/src/session-contracts.ts";
import { bashTool } from "../../tools/bash-tool.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";
import { EvaluationAnswers, isCompleteEvaluationAnswer } from "./evaluation-answers.ts";
import type { ResearchEvaluationOptions } from "./research-evaluation.ts";
import { checkSkillEvaluationAnswer, knownSkillAnswerViolations } from "./skill-evaluation-answer.ts";
import { skillEvaluationCase, type SkillEvaluationCase } from "./skill-evaluation-fixtures.ts";
import { calculateWeightedScoreTool } from "../../tools/weighted-score-tool.ts";

export { checkSkillEvaluationAnswer, knownSkillAnswerViolations } from "./skill-evaluation-answer.ts";
export { SKILL_EVALUATION_CASES, skillEvaluationCase, type SkillEvaluationCase } from "./skill-evaluation-fixtures.ts";

const REPOSITORY_DIR = "LLMQuant-skills";

export interface SkillWorkflowRead {
  commandHash: string;
  workflow: string;
  status: "accepted" | "rejected";
  reason?: string;
}

export interface SkillEvaluationTrace {
  reads: SkillWorkflowRead[];
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Snapshot the entry and selected workflow for an isolated evaluation, without a production certification gate. */
export function stageSkillEvaluation(id: SkillEvaluationCase, installedSkillsRoot: string, evaluationRoot: string) {
  const fixture = skillEvaluationCase(id);
  const files = ["SKILL.md", fixture.workflow];
  const sourceRoot = resolve(installedSkillsRoot, REPOSITORY_DIR, "skills", fixture.skill);
  const targetRoot = resolve(evaluationRoot, "skills", REPOSITORY_DIR, "skills", fixture.skill);
  for (const file of files) {
    const source = resolve(sourceRoot, file), target = resolve(targetRoot, file);
    const withinSource = relative(sourceRoot, source), withinTarget = relative(targetRoot, target);
    if (withinSource === ".." || withinSource.startsWith(`..${sep}`) || withinTarget === ".." || withinTarget.startsWith(`..${sep}`)) {
      throw new Error(`Skill evaluation file escapes its reviewed root: ${file}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  const skillFile = join(targetRoot, "SKILL.md");
  return { fixture, skillFile, workflowFile: join(targetRoot, fixture.workflow), stagedFiles: files };
}

function commandText(args: unknown): string {
  if (!args || typeof args !== "object" || !("command" in args)) return "";
  const command = args.command;
  return Array.isArray(command) ? command.map(String).join(" ") : typeof command === "string" ? command : "";
}

/** A bash-compatible, read-only evaluation port. It can return exactly one staged workflow and cannot execute a shell. */
export function createSkillWorkflowReader(workflowFile: string, workflow = skillEvaluationCase("skill-risk-health").workflow): { tool: AgentTool; trace: SkillEvaluationTrace } {
  const canonical = realpathSync(workflowFile), normalizedPath = canonical.replace(/\\/g, "/").toLowerCase();
  const normalizedWorkflow = workflow.replace(/\\/g, "/").toLowerCase();
  const trace: SkillEvaluationTrace = { reads: [] };
  const tool: AgentTool = {
    ...bashTool,
    description: `${bashTool.description} This isolated evaluation allows one read-only Get-Content/cat/type command for the selected local workflow; no command is executed by a shell.`,
    async execute(_toolCallId, args, signal) {
      signal?.throwIfAborted();
      const command = commandText(args), normalized = command.replace(/\\/g, "/").toLowerCase();
      const reader = /^\s*(?:get-content|gc|cat|type)\b/i.test(command);
      const expected = normalized.includes(normalizedPath) || normalized.includes(normalizedWorkflow);
      const unsafe = /[;\r\n|&><`]|\$\(|\b(?:remove-item|set-content|add-content|out-file|invoke-|curl|wget|start-process)\b/i.test(command);
      const alreadyRead = trace.reads.some(read => read.status === "accepted");
      if (!command || !reader || !expected || unsafe || alreadyRead) {
        const reason = "Only one simple read of the selected staged workflow is allowed.";
        trace.reads.push({ commandHash: hashText(command), workflow, status: "rejected", reason });
        throw new Error(reason);
      }
      const content = readFileSync(canonical, "utf8");
      trace.reads.push({ commandHash: hashText(command), workflow, status: "accepted" });
      return { content: [{ type: "text", text: `Exit code: 0\n${content.trimEnd()}` }],
        details: { evaluation: true, readOnly: true, workflow, contentHash: hashText(content.replace(/\r\n/g, "\n")) } };
    },
  };
  return { tool, trace };
}

/** Real production skill entry and Pi loop; isolated reviewed Markdown, read-only workflow tool, and no external data tools. */
export async function runSkillEvaluation(id: SkillEvaluationCase, dependencies: QuantAgentDependencies,
  trace: SkillEvaluationTrace, options: ResearchEvaluationOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000, maxRequests = options.maxRequests ?? 6;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000 || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 50) {
    throw new Error("Invalid evaluation limits");
  }
  const fixture = skillEvaluationCase(id), requiredTools = fixture.weightedScore ? ["bash", calculateWeightedScoreTool.name] : ["bash"];
  if (!isDeepStrictEqual(dependencies.tools.map(tool => tool.name).sort(), [...requiredTools].sort()) || dependencies.readTools
    || (fixture.weightedScore && dependencies.tools.find(tool => tool.name === calculateWeightedScoreTool.name) !== calculateWeightedScoreTool)) {
    throw new Error("Skill evaluation requires the isolated workflow reader and only its declared production arithmetic tool, with no dynamic registry.");
  }
  const connection = dependencies.readConnection();
  const startedAt = new Date().toISOString(), started = performance.now(), controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let agent: QuantAgentSession = createQuantResearchAgent({ dependencies }), requests = 0, limited = false;
  let inputTokens = 0, outputTokens = 0, outcome = "finished", failure: string | undefined;
  const completion = new EvaluationAnswers(), providerPayloads: string[] = [], toolCalls: Array<{ name: string; inputHash: string }> = [];
  const toolFailures: Array<{ tool: string; message: string }> = [];
  const weightedInputs: unknown[] = [];
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const unsubscribe = agent.subscribe(event => {
    completion.observe(event);
    if (event.type === "before_provider_request") {
      if (requests >= maxRequests) { limited = true; controller.abort(); } else requests++;
    }
    if (event.type === "before_provider_payload") providerPayloads.push(JSON.stringify(event.payload));
    if (event.type !== "message_end") return;
    if (event.message.role === "assistant") {
      inputTokens += event.message.usage.input; outputTokens += event.message.usage.output;
      for (const part of event.message.content) if (part.type === "toolCall") {
        toolCalls.push({ name: part.name, inputHash: hashText(JSON.stringify(part.arguments)) });
        if (part.name === calculateWeightedScoreTool.name) weightedInputs.push(structuredClone(part.arguments));
      }
    }
    if (event.message.role === "toolResult" && event.message.isError) {
      toolFailures.push({ tool: event.message.toolName, message: event.message.content.filter(part => part.type === "text").map(part => part.text).join("\n") });
    }
  });
  let discovered = false;
  try {
    const skill = (await agent.getSkills()).find(candidate => candidate.name === fixture.skill);
    discovered = !!skill;
    await agent.skill(fixture.skill, fixture.prompt, { signal }); signal.throwIfAborted();
    if (agent.state.errorMessage) outcome = "request-failed";
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    outcome = signal.aborted ? options.signal?.aborted ? "cancelled" : limited ? "request-limit" : "timeout" : "request-failed";
  } finally {
    clearTimeout(timer); agent.abort(); await agent.waitForIdle(); completion.finish(!!agent.state.errorMessage); unsubscribe();
  }
  const answer = completion.answers[0]!, answerChecks = checkSkillEvaluationAnswer(id, answer?.text ?? "");
  const knownClaimViolations = knownSkillAnswerViolations(id, answer?.text ?? "");
  const accepted = trace.reads.filter(read => read.status === "accepted"), rejected = trace.reads.filter(read => read.status === "rejected");
  const injection = providerPayloads[0] ?? "", workflowPayload = providerPayloads.slice(1).some(payload => payload.includes(fixture.workflowMarker));
  const checks = [
    { name: "selected skill is loaded", passed: discovered },
    { name: "explicit skill invocation reaches the provider", passed: injection.includes(fixture.skill)
      && fixture.injectionNeedles.every(needle => injection.includes(needle)) },
    { name: "model selects and reads exactly the expected reviewed workflow", passed: accepted.length === 1 && accepted[0]?.workflow === fixture.workflow
      && rejected.length === 0 && toolCalls.filter(call => call.name === "bash").length === 1
      && toolCalls.length === requiredTools.length && toolCalls.every(call => requiredTools.includes(call.name)) },
    { name: "selected workflow content returns through the next provider request", passed: workflowPayload },
    { name: "workflow reader and model tool calls complete without errors", passed: toolFailures.length === 0 },
    { name: "final answer retains all supplied evidence and dates", passed: answerChecks.evidence && answerChecks.dates },
    { name: "final answer preserves evidence limits and read-only behavior", passed: answerChecks.boundary && answerChecks.noMutation },
    { name: "final answer preserves supplied observation and report-date time boundaries", passed: knownClaimViolations.length === 0 },
    { name: "nonempty normally completed answer retained for semantic review", passed: isCompleteEvaluationAnswer(answer) },
  ];
  if (fixture.weightedScore) checks.push(
    { name: "production weighted calculation receives exactly the supplied snapshot and component inputs", passed: weightedInputs.length === 1
      && matchesWeightedInput(weightedInputs[0], fixture.weightedScore) },
    { name: "production weighted arithmetic receipt returns through the following provider request", passed: providerPayloads.slice(1)
      .some(payload => payload.includes("explicit-supplied-score-components")) },
  );
  if (outcome === "finished" && completion.failure) outcome = completion.failure;
  return { version: 1, kind: "skill-model-evaluation", case: id, startedAt, completedAt: new Date().toISOString(), durationMs: performance.now() - started,
    config: { provider: connection.model.provider, model: connection.model.id, api: connection.model.api, thinking: connection.thinkingLevel,
      endpointHash: createHash("sha256").update(connection.model.baseUrl).digest("hex"), toolNames: agent.state.tools.map(tool => tool.name), timeoutMs, maxRequests },
    fixture: { kind: "reviewed-skill-and-supplied-workspace-snapshot", skill: fixture.skill, workflow: fixture.workflow, liveMarketAccess: false, prompt: fixture.prompt },
    outcome, requests, usage: { inputTokens, outputTokens }, checks, passed: outcome === "finished" && checks.every(check => check.passed),
    discovered, trace, toolCalls, toolFailures, knownClaimViolations, answers: completion.answers, ...(failure ? { failure } : {}),
    reviewRequired: "Review the retained answer for prioritization and wording. Automated checks prove explicit skill injection, one reviewed workflow read, supplied fact/date retention, and stated evidence/read-only boundaries; they do not prove general workflow selection or financial advice quality." };
}

function matchesWeightedInput(actual: unknown, expected: NonNullable<ReturnType<typeof skillEvaluationCase>["weightedScore"]>): boolean {
  if (!actual || typeof actual !== "object" || !("components" in actual) || !Array.isArray(actual.components)) return false;
  const values: unknown[] = actual.components, components: Array<{ name: string; value: unknown }> = [];
  for (const value of values) {
    if (!value || typeof value !== "object" || !("name" in value) || typeof value.name !== "string") return false;
    components.push({ name: value.name, value });
  }
  return isDeepStrictEqual({ ...actual, components: components.sort((a, b) => a.name.localeCompare(b.name)).map(component => component.value) },
    { ...expected, components: [...expected.components].sort((a, b) => a.name.localeCompare(b.name)) });
}
