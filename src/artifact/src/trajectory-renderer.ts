/** Turn-oriented audit renderer for persisted user, assistant and tool events. */
import { esc } from "./template.ts";
import { highlight } from "./renderers.ts";
import type { TrajectoryDocument, TrajectoryEvent, TrajectorySummary } from "./types.ts";

export function renderTrajectoryDocument(traj: TrajectoryDocument): string {
  return `${renderTrajSummaryBar(traj.summary)}<div class="traj-timeline">${renderTurns(traj.events)}</div>`;
}

function renderTrajSummaryBar(s: TrajectorySummary): string {
  const toolsList = s.toolsUsed.length > 0
    ? s.toolsUsed.map((tool) => `<code>${esc(tool)}</code>`).join(" ")
    : "-";
  const skillsList = s.skillsUsed.length > 0
    ? s.skillsUsed.map((skill) => `<code>${esc(skill)}</code>`).join(" ")
    : "-";
  return `<div class="traj-summary-bar">
    <span><strong>${s.turnCount}</strong> turns / <strong>${s.totalEvents}</strong> events</span>
    <span><strong>${s.toolCallCount}</strong> calls / <strong>${s.skillCallCount}</strong> skills</span>
    <span><strong>${s.successToolCallCount}</strong> ok / <strong>${s.failedToolCallCount}</strong> fail</span>
    <span class="traj-capture${s.capturedContentBlockCount === s.sourceContentBlockCount ? " complete" : " incomplete"}"><strong>${s.capturedContentBlockCount}/${s.sourceContentBlockCount}</strong> blocks captured</span>
    <span><strong>${s.thinkingCount}</strong> thinking / <strong>${s.compactionCount}</strong> compact</span>
    <span class="traj-tools"><small>TOOLS</small>${toolsList}<small>SKILLS</small>${skillsList}</span>
  </div>`;
}

function renderTurns(events: TrajectoryEvent[]): string {
  const groups = new Map<number, TrajectoryEvent[]>();
  for (const event of events) {
    if (event.visibility === "hidden") continue;
    const turn = event.turnIndex ?? 0;
    groups.set(turn, [...(groups.get(turn) ?? []), event]);
  }
  return [...groups.entries()].map(([turn, turnEvents]) => renderTurn(turn, turnEvents)).join("\n");
}

function renderTurn(turn: number, events: TrajectoryEvent[]): string {
  const calls = events.filter((event) => event.type === "tool_call").length;
  const skills = events.filter((event) => event.type === "tool_call" && event.tool?.kind === "skill").length;
  const results = events.filter((event) => event.type === "tool_result").length;
  const outputs = events.filter((event) => event.type === "observation" || event.type === "final_answer").length;
  const timestamp = events.find((event) => event.timestamp)?.timestamp;
  const label = turn > 0 ? `TURN ${String(turn).padStart(2, "0")}` : "CONTEXT";
  return `<section class="traj-turn">
    <header class="traj-turn-head"><span>${label}</span><i></i><span class="traj-turn-counts"><b>${calls}</b> calls <b>${results}</b> returns${skills ? ` <b>${skills}</b> skills` : ""} <b>${outputs}</b> outputs</span><small>${timestamp ? formatTimestamp(timestamp) : ""}</small></header>
    <div class="traj-turn-events">${events.map(renderEvent).join("\n")}</div>
  </section>`;
}

function renderEvent(event: TrajectoryEvent): string {
  switch (event.type) {
    case "user_request":
      return renderUserInput(stringValue(event.raw) || event.summary || event.title, event);
    case "model_input":
      return renderModelInput(event);
    case "assistant_thinking":
      return renderThinking(event);
    case "context_compaction":
      return renderCompaction(event);
    case "raw_content":
      return renderRawContent(event);
    case "tool_call":
      return renderToolCall(event);
    case "tool_result":
      return renderToolResult(event);
    case "observation":
    case "final_answer":
      return renderAssistantOutput(stringValue(event.raw) || event.summary || event.title, event);
    default:
      return renderMeta(event.summary || event.title, event.timestamp);
  }
}

function renderUserInput(text: string, event: TrajectoryEvent): string {
  return `<article class="traj-blk traj-user">
    ${eventHeader("USER INPUT", event.timestamp, "input")}
    <div class="traj-blk-body traj-user-input">${highlightUserCommands(text)}</div>
    ${renderSource(event)}
  </article>`;
}

function renderAssistantOutput(text: string, event: TrajectoryEvent): string {
  return `<article class="traj-blk traj-assistant">
    ${eventHeader(event.type === "final_answer" ? "FINAL ANSWER" : "ASSISTANT OUTPUT", event.timestamp, "output")}
    <div class="traj-blk-body traj-assistant-output">${highlightKeyResults(text)}</div>
    ${renderSource(event)}
  </article>`;
}

function renderThinking(event: TrajectoryEvent): string {
  const text = stringValue(event.raw) || event.summary || "(empty thinking block)";
  return `<details class="traj-blk traj-thinking">
    <summary>${eventHeader("ASSISTANT THINKING", event.timestamp, "thinking")}<span class="traj-fold-hint">persisted reasoning</span></summary>
    <pre class="traj-thinking-body">${esc(text)}</pre>
    ${renderSource(event)}
  </details>`;
}

function renderModelInput(event: TrajectoryEvent): string {
  const text = stringValue(event.raw) || event.summary || "(empty model input)";
  return `<details class="traj-blk traj-model-input">
    <summary>${eventHeader("MODEL INPUT", event.timestamp, "input")}<span class="traj-fold-hint">expanded prompt</span></summary>
    <pre class="traj-model-input-body">${highlightUserCommands(text)}</pre>
    ${renderSource(event)}
  </details>`;
}

function renderCompaction(event: TrajectoryEvent): string {
  const text = stringValue(event.raw) || event.summary || "Compaction boundary";
  return `<details class="traj-blk traj-compaction">
    <summary>${eventHeader("CONTEXT COMPACTION", event.timestamp, "compact")}<span class="traj-fold-hint">${esc(event.source?.entryId || "")}</span></summary>
    <pre class="traj-compaction-body">${highlightKeyResults(text)}</pre>
    ${renderSource(event)}
  </details>`;
}

function renderRawContent(event: TrajectoryEvent): string {
  return `<details class="traj-blk traj-raw">
    <summary>${eventHeader("RAW SOURCE", event.timestamp, "meta")}<span class="traj-fold-hint">${esc(event.title)}</span></summary>
    <pre class="traj-raw-body">${esc(stringValue(event.raw))}</pre>
    ${renderSource(event)}
  </details>`;
}

function renderToolCall(event: TrajectoryEvent): string {
  const name = event.tool?.name || event.title || "tool";
  const kind = event.tool?.kind || (/^(bash|shell|powershell|pwsh)$/i.test(name) ? "bash" : "tool");
  const isBash = kind === "bash";
  const isSkill = kind === "skill";
  const command = extractCommand(event.tool?.args);
  const argsText = event.tool?.args ? JSON.stringify(event.tool.args, null, 2) : "";
  const label = event.redaction?.hasRedaction
    ? `${esc(name)} <span class="traj-redacted">REDACTED</span>`
    : esc(name);
  const callLabel = isBash ? "BASH COMMAND" : isSkill ? "SKILL CALL" : "TOOL CALL";
  return `<details class="traj-blk traj-tool${isBash ? " traj-bash" : ""}${isSkill ? " traj-skill" : ""}" data-call-id="${esc(event.tool?.callId || "")}" open>
    <summary>${eventHeader(callLabel, event.timestamp, isBash ? "terminal" : isSkill ? "skill" : "tool")}<span class="traj-phase traj-phase-call">CALL</span><span class="traj-tool-name">${label}</span><code class="traj-call-id">${esc(event.tool?.callId || "")}</code></summary>
    ${command ? `<pre class="traj-command-block"><span>$</span> ${esc(command)}</pre>` : ""}
    <div class="traj-payload-label">FULL ARGUMENTS</div>
    <pre class="traj-tool-args">${argsText ? esc(argsText) : "(no arguments)"}</pre>
    ${renderSource(event)}
  </details>`;
}

function renderToolResult(event: TrajectoryEvent): string {
  const text = stringValue(event.tool?.resultPreview);
  const details = stringValue(event.tool?.resultDetails);
  const isError = event.status === "error";
  const name = event.tool?.name || event.title || "tool";
  const isSkill = event.tool?.kind === "skill";
  const resultLabel = isError ? (isSkill ? "SKILL ERROR" : "TOOL ERROR") : (isSkill ? "SKILL RESULT" : "TOOL RESULT");
  return `<details class="traj-blk traj-result${isError ? " traj-result-error" : ""}${isSkill ? " traj-skill-result" : ""}" data-call-id="${esc(event.tool?.callId || "")}" open>
    <summary>${eventHeader(resultLabel, event.timestamp, isError ? "error" : isSkill ? "skill" : "result")}<span class="traj-phase traj-phase-return">RETURN</span><span class="traj-result-label">${esc(name)}</span><code class="traj-call-id">${esc(event.tool?.callId || "")}</code></summary>
    <div class="traj-payload-label">FULL RETURN</div>
    <pre class="traj-result-body">${text ? highlightKeyResults(text) : `<em>(empty tool result)</em>`}</pre>
    ${details ? `<div class="traj-payload-label">RETURN METADATA</div><pre class="traj-result-meta">${esc(details)}</pre>` : ""}
    ${renderSource(event)}
  </details>`;
}

function renderMeta(text: string, timestamp?: string): string {
  return `<div class="traj-blk traj-meta">${eventHeader("SYSTEM", timestamp, "meta")}<div class="traj-blk-body">${esc(text)}</div></div>`;
}

function eventHeader(label: string, timestamp: string | undefined, kind: string): string {
  return `<span class="traj-event-head"><i class="traj-event-icon traj-icon-${kind}"></i><b>${label}</b>${timestamp ? `<time>${formatTimestamp(timestamp)}</time>` : ""}</span>`;
}

function renderSource(event: TrajectoryEvent): string {
  if (!event.source) return "";
  const source = event.source;
  const block = source.blockIndex === undefined ? "" : ` · block ${source.blockIndex}`;
  const role = source.role ? ` · ${source.role}` : "";
  const stop = source.stopReason ? ` · ${source.stopReason}` : "";
  const label = `${source.entryId || "source"}${block}${role}${stop}`;
  return `<details class="traj-source"><summary>SOURCE <code>${esc(label)}</code></summary><pre>${esc(JSON.stringify(source, null, 2))}</pre></details>`;
}

function highlightUserCommands(text: string): string {
  return text.split(/\r?\n/).map((line) => {
    const command = /^\s*(\/\w[\w:-]*(?:\s.*)?|(?:\$\s*)?(?:git|bun|npm|npx|python|python3|pwsh|powershell|rg|Get-[A-Za-z]+|Set-[A-Za-z]+)\b.*)$/i.test(line);
    return command ? `<code class="traj-user-command">${esc(line)}</code>` : esc(line);
  }).join("\n");
}

function highlightKeyResults(text: string): string {
  return text.split(/\r?\n/).map((line) => {
    const important = /\b(composite|score|total return|annual return|sharpe|drawdown|exposure|signal|risk|result|status|success|failed|error|warning|price|change)\b|收益|回撤|风险|得分|评分|信号|结论|建议|涨跌|价格|(?:^|\s)[+-]?\d+(?:\.\d+)?%/i.test(line);
    const polarity = /^\s*(?:(?:status|result|状态|结果)\s*[:：]?\s*)?(?:error|failed|warning|失败|错误)\b/i.test(line)
      ? " negative"
      : /^\s*(?:(?:status|result|状态|结果)\s*[:：]?\s*)?(?:success|healthy|ready|ok|成功|就绪)\b/i.test(line) ? " positive" : "";
    return important ? `<span class="traj-key-result${polarity}">${highlight(esc(line))}</span>` : esc(line);
  }).join("\n");
}

function extractCommand(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const command = (args as Record<string, unknown>).command;
  return typeof command === "string" ? command : "";
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value, null, 2);
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 19);
  return date.toISOString().slice(11, 19);
}
