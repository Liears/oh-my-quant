import { expect, it } from "bun:test";
import { hedgeScenarioAnswerViolations } from "../evidence/hedge-scenario-answer.ts";
import { knownSkillAnswerViolations } from "../evaluation/skill-evaluation-answer.ts";
import { skillEvaluationCase } from "../evaluation/skill-evaluation-fixtures.ts";

const position = { shares: 200, costPerShare: 50, observedClose: 42 };
const header = "场景          假设收盘价    头寸价值    盈亏 vs 成本             对冲结果";

it("rejects the retained real +10% scenario with P/L240 rather than760", () => {
  const answer = `${header}\n+10%            USD 46.20        USD 9,240     -USD -240 (-2.4%)        待定 — 需要期权链字段`;
  expect(hedgeScenarioAnswerViolations(answer, position)).toContain("wrong-hedge-scenario-pnl");
  expect(hedgeScenarioAnswerViolations(answer, position)).toContain("wrong-hedge-scenario-pnl-percent");
});

it.each([
  ["+10%  45.20  9,240  -760 (-7.6%)  unknown", "wrong-hedge-scenario-price"],
  ["+10%  46.20  9,000  -760 (-7.6%)  unknown", "wrong-hedge-scenario-value"],
  ["+10%  46.20  9,240  -240 (-7.6%)  unknown", "wrong-hedge-scenario-pnl"],
  ["+10%  46.20  9,240  -760 (-2.4%)  unknown", "wrong-hedge-scenario-pnl-percent"],
  ["+10%  46.20  9,240  +760 (+7.6%)  unknown", "wrong-hedge-scenario-pnl"],
])("rejects an independently inconsistent labelled field: %s", (row, code) => {
  expect(hedgeScenarioAnswerViolations(`${header}\n${row}`, position)).toContain(code);
});

it("accepts the independently checked unhedged scenarios", () => {
  const answer = `${header}\n-10%  37.80  7,560  -2,440 (-24.4%)  unknown\n-20%  33.60  6,720  -3,280 (-32.8%)  unknown\nflat  42.00  8,400  -1,600 (-16.0%)  unknown\n+10%  46.20  9,240  -760 (-7.6%)  unknown\nBack to cost  50.00  10,000  0 (0.0%)  unknown`;
  expect(hedgeScenarioAnswerViolations(answer, position)).toEqual([]);
});

it("checks separate percentage columns in a Markdown scenario table", () => {
  const answer = "| Scenario | Price | Position value | P/L vs cost | Return vs cost (%) | Hedge |\n|---|---|---|---|---|---|\n| +10% | $46.20 | $9,240 | -$760 | -2.4% | unknown |";
  expect(hedgeScenarioAnswerViolations(answer, position)).toEqual(["wrong-hedge-scenario-pnl-percent"]);
});

it.each([[-7.6, []], [-2.4, ["wrong-hedge-scenario-pnl-percent"]]] as const)("uses percent units from the header for bare cell %s", (percent, violations) => {
  const answer = `Scenario   Price    Position value   P/L vs cost   Return vs cost (%)\n+10%       46.20    9,240.00         -760.00       ${percent}`;
  expect(hedgeScenarioAnswerViolations(answer, position)).toEqual([...violations]);
});

it("uses the supplied position rather than hardcoded HEDG numbers", () => {
  const answer = `${header}\n+20%  12.00  30.00  +10.00 (+50.0%)  unknown`;
  expect(hedgeScenarioAnswerViolations(answer, { shares: 2.5, costPerShare: 8, observedClose: 10 })).toEqual([]);
  expect(hedgeScenarioAnswerViolations(answer, position)).toContain("wrong-hedge-scenario-price");
});

it("allows displayed rounding and distinguishes cost from close-to-scenario change", () => {
  const answer = `${header}\n+10%  46.2  9240  -760 (-7.60%)  unknown`;
  expect(hedgeScenarioAnswerViolations(answer, position)).toEqual([]);
});

it("ignores quoted counterexamples, unlabelled values and tables without supplied position evidence", () => {
  const answer = `${header}\n+10%  46.20  9,240  -240 (-2.4%)  unknown`;
  expect(hedgeScenarioAnswerViolations(`\`\`\`text\n${answer}\n\`\`\``, position)).toEqual([]);
  expect(hedgeScenarioAnswerViolations(answer.split("\n").map(line => `> ${line}`).join("\n"), position)).toEqual([]);
  expect(hedgeScenarioAnswerViolations("+10%  46.20  9,240  -240 (-2.4%)", position)).toEqual([]);
  expect(hedgeScenarioAnswerViolations(answer)).toEqual([]);
});

it("does not assign a stock arithmetic result to an IV shock without a price scenario", () => {
  expect(hedgeScenarioAnswerViolations(`${header}\nIV shock  n/a  n/a  n/a  unknown`, position)).toEqual([]);
});

it("rejects an impossible stock scenario below minus100 percent", () => {
  expect(hedgeScenarioAnswerViolations(`${header}\n-110%  -4.20  -840  -10,840 (-108.4%)  unknown`, position))
    .toContain("invalid-hedge-scenario-change");
});

it("binds the production evaluation check and prompt to the same explicit inputs", () => {
  const fixture = skillEvaluationCase("skill-risk-hedge");
  expect(fixture.hedgePosition).toEqual(position);
  expect(fixture.prompt).toContain("10% | 46.20 | 9240.00 | -760.00 | -7.6%");
  expect(hedgeScenarioAnswerViolations(fixture.prompt, position)).toEqual([]);
  expect(knownSkillAnswerViolations("skill-risk-hedge", `${header}\n+10%  46.20  9,240  -240 (-2.4%)  unknown`))
    .toContain("wrong-hedge-scenario-pnl");
});
