import { expect, it } from "bun:test";
import { projectResearchState } from "../../research/state.ts";
import { auditCurrentAnnualAnswer } from "../evidence/annual-answer-evidence.ts";

function state(tool = "annual_report", isError = false, reportId: string | undefined = "annual-fixture") {
  return projectResearchState([
    { id: "call", type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "annual-call", name: tool, arguments: {} }] } },
    { id: "result", type: "message", message: { role: "toolResult", toolCallId: "annual-call", toolName: tool, isError,
      content: [{ type: "text", text: "Synthetic recorded link" }], details: { id: reportId, kind: "annual-research" } } },
  ], [tool]);
}
const table = "| Series | Alpha |\n| Core | +5pp |";

it("binds the method check to the cited annual generation or restore in the current branch", () => {
  for (const tool of ["annual_report", "annual_reports"]) {
    expect(auditCurrentAnnualAnswer(state(tool), `annual-fixture\n${table}`))
      .toEqual({ status: "audited", violations: ["excess-return-labelled-alpha"] });
  }
});

it("does not apply an old annual method to unrelated alpha analysis or uncited records", () => {
  expect(auditCurrentAnnualAnswer(state(), `CAPM analysis unrelated to this annual record\n${table}`))
    .toEqual({ status: "not-annual", violations: [] });
  for (const candidate of [state("annual_report", true), state("research_decisions"), state("annual_report", false, "")]) {
    expect(auditCurrentAnnualAnswer(candidate, `annual-fixture\n${table}`))
      .toEqual({ status: "not-annual", violations: [] });
  }
});

it("allows a cited report with correctly labelled excess return", () => {
  expect(auditCurrentAnnualAnswer(state(), "annual-fixture\nCore 超额收益为 +5 个百分点，不是风险调整 alpha。"))
    .toEqual({ status: "audited", violations: [] });
});
