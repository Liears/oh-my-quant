import type { QuantAgentEvent } from "../../agent/src/session-contracts.ts";
import type { EvaluationPhase } from "./research-evaluation-audit.ts";

export interface EvaluationAnswer {
  phase: EvaluationPhase;
  text: string;
  stopReason: string | null;
  hasError: boolean;
  toolCallCount: number;
}

export function isCompleteEvaluationAnswer(answer: EvaluationAnswer): boolean {
  return !answer.hasError && answer.stopReason === "stop" && answer.toolCallCount === 0 && answer.text.trim().length > 0;
}

/** Observe only this prompt's events, never a previous answer loaded from session history. */
export class EvaluationAnswers {
  readonly answers: EvaluationAnswer[] = [];
  failure: "request-failed" | "no-final-answer" | null = null;
  private phase: EvaluationPhase = "research";
  private latest: Omit<EvaluationAnswer, "phase"> | null = null;

  begin(phase: EvaluationPhase): void { this.phase = phase; this.latest = null; }

  observe(event: QuantAgentEvent): void {
    if ((event.type !== "message_end" && event.type !== "message_update") || event.message.role !== "assistant") return;
    const message = event.message;
    this.latest = { text: message.content.filter(part => part.type === "text").map(part => part.text).join("\n"),
      stopReason: event.type === "message_end" ? message.stopReason : null,
      hasError: message.stopReason === "error" || message.stopReason === "aborted",
      toolCallCount: message.content.filter(part => part.type === "toolCall").length };
  }

  finish(hasError: boolean): EvaluationAnswer {
    const saved = this.answers.find(answer => answer.phase === this.phase);
    if (saved) return saved;
    const answer = { phase: this.phase, text: this.latest?.text ?? "", stopReason: this.latest?.stopReason ?? null,
      hasError: hasError || this.latest?.hasError === true, toolCallCount: this.latest?.toolCallCount ?? 0 };
    this.answers.push(answer);
    if (!isCompleteEvaluationAnswer(answer)) this.failure ??= answer.hasError || answer.stopReason !== null && answer.stopReason !== "stop" || answer.toolCallCount > 0
      ? "request-failed" : "no-final-answer";
    return answer;
  }
}
