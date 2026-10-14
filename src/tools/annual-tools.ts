import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { generateAnnualReport, listAnnualReports, restoreAnnualReport } from "../runtime/research/annual-reports.ts";
import { ok } from "./shared/results.ts";
import { researchDecisionsTool } from "./research-decision-tool.ts";

const Generate = Type.Object({ comparison_id: Type.String({ minLength: 1 }), year: Type.Integer({ minimum: 1900, maximum: 9999 }),
  valuation_cutoff: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  decision_ids: Type.Optional(Type.Array(Type.String({ pattern: "^[a-f0-9]{64}$" }), { minItems: 1, maxItems: 20, uniqueItems: true,
    description: "Explicit research_decisions IDs for these same ordered groups and report year/cutoff. No automatic inference of decisions." })),
  decision_scope: Type.Optional(Type.Literal("all-recorded", { description: "Opt in to all locally recorded, verifiable declarations matching these ordered groups and year/cutoff at generation. Cannot combine with decision_ids; no claim about real trades or unrecorded decisions." })) }, { additionalProperties: false });
const History = Type.Object({ id: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false });

export const annualReportTool: AgentTool<typeof Generate> = {
  name: "annual_report", label: "Annual research report", parameters: Generate, executionMode: "sequential",
  description: "Generate a local offline annual/YTD observation research HTML from an explicitly selected saved portfolio comparison. Its requested window must be Jan 1 through valuation_cutoff in year; list portfolio_comparisons first or create a matching comparison. Rechecks exact public price/NAV archives, FX and arithmetic. Optional decision_ids select immutable research_decisions; decision_scope=all-recorded explicitly freezes every locally verifiable matching journal entry (1–20), failing on unavailable inventory, and cannot combine with IDs. Neither proves unrecorded decisions, approval or trades. Includes coverage gaps and attributed Buffett/Marks historical perspectives. No network, account performance or publishing; never present hypothetical returns as real account returns. Returns report ID and HTML path. Does not open a browser; /artifact does not list these annual reports.",
  async execute(_id, args, signal) {
    const result = generateAnnualReport({ comparisonId: args.comparison_id, year: args.year, valuationCutoff: args.valuation_cutoff, ...(args.decision_ids ? { decisionIds: args.decision_ids } : {}) }, signal, args.decision_scope);
    return ok(`Annual research saved: ${result.id}\nHTML: ${result.path}\nValuation cutoff: ${result.request.valuationCutoff}\nResearch decision history: ${result.strategyHistory}${result.request.decisionSelection ? ` (${result.request.decisionSelection}; ${result.decisionHashes.length} locally recorded entries frozen)` : ""}. Actual account performance: not connected.\nInterpretation of the verified comparison:\n${result.interpretationNotes.join("\n")}`, result);
  },
};

export const annualReportsTool: AgentTool<typeof History> = {
  name: "annual_reports", label: "Saved annual research", parameters: History, executionMode: "sequential",
  description: "List annual research report IDs after checking original evidence, or restore one ID to its original offline HTML and return the path. Missing or corrupt report/comparison/price archives fail visibly and remain on disk. No current group lookup, refreshed data or account access. Does not restore an Agent session or open the browser.",
  async execute(_id, args, signal) {
    signal?.throwIfAborted();
    if (args.id) {
      const result = restoreAnnualReport(args.id, signal);
      return ok(`Annual research restored: ${result.id}\nHTML: ${result.path}\nOriginal comparison, selected decisions and public archives rechecked. Research decision history: ${result.strategyHistory}. Actual account performance: not connected.\nCurrent interpretation of original verified inputs (saved HTML unchanged):\n${result.interpretationNotes.join("\n")}`, result);
    }
    const result = listAnnualReports(signal);
    return ok([...result.items.map(item => `${item.id} · ${item.request.year} through ${item.request.valuationCutoff} · ${item.createdAt}`),
      ...(result.items.length ? [] : ["No restorable annual research reports."]), `Unavailable files: ${result.unavailable.length}`].join("\n"), result);
  },
};
export const ANNUAL_TOOLS: AgentTool[] = [annualReportTool, annualReportsTool, researchDecisionsTool];
