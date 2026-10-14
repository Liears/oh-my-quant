import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { recordResearchDecision, readResearchDecisions } from "../runtime/research/research-decisions.ts";
import { ok } from "./shared/results.ts";

const Parameters = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("read"), Type.Literal("record")]),
  id: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
  decision: Type.Optional(Type.Object({
    requestId: Type.String({ pattern: "^[A-Za-z0-9_-]{8,128}$", description: "Stable idempotency ID. Retry identical content with the same ID; changed content needs a new ID." }),
    comparisonId: Type.String({ minLength: 1 }), declaredDate: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
    choice: Type.Union([Type.Literal("retain"), Type.Literal("revise"), Type.Literal("defer"), Type.Literal("reject")]),
    rationale: Type.String({ minLength: 1, maxLength: 4000 }),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

export const researchDecisionsTool: AgentTool<typeof Parameters> = {
  name: "research_decisions", label: "Research decisions", parameters: Parameters, executionMode: "sequential",
  description: "List or read an immutable research decision journal, or record an explicit choice/rationale/date bound to a saved comparison and rechecked public archives. list takes no id/decision; read takes only id; record takes only decision. Records are tool-input claims, not verified user approval, real trades or account history. declaredDate is a claimed date, recordedAt is actual UTC recording time; retrospective entries and later comparison evidence are disclosed. Never infer decisions from static portfolio snapshots. No network, order or portfolio edits. Select returned IDs in annual_report.decision_ids; private rationale is excluded from public sharing.",
  async execute(_id, args, signal) {
    if (args.action === "record") {
      if (!args.decision || args.id !== undefined) throw new Error("record requires only decision.");
      const result = recordResearchDecision(args.decision, signal);
      return ok(`Research decision recorded: ${result.decision.id}\nResearch statement only; not verified approval or execution.\n${JSON.stringify(result)}`, result);
    }
    if (args.decision !== undefined || args.action === "read" && !args.id || args.action === "list" && args.id !== undefined) throw new Error("Use list without arguments or read with only id.");
    const result = readResearchDecisions(args.action === "read" ? args.id : undefined, signal);
    if (args.action === "read") return ok(`Research statement only; not verified approval or execution.\n${JSON.stringify(result)}`, result);
    return ok([...result.items.map(entry => `${entry.decision.id} · ${entry.decision.request.declaredDate} · ${entry.decision.request.choice} · comparison ${entry.decision.request.comparisonId}`),
      ...(result.items.length ? [] : ["No available research decisions."]), `Unavailable files: ${result.unavailable.length}`].join("\n"), result);
  },
};
