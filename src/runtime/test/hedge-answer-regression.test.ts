import { expect, it } from "bun:test";
import { knownSkillAnswerViolations } from "../evaluation/skill-evaluation-answer.ts";
import { hedgeFrameworkClaimViolations } from "../evidence/hedge-framework-claims.ts";

it("allows the retained funded rollover with continuous coverage to that date", () => {
  const answer = "Expiry list covering through 2026-12-31; an expiry before 2026-12-31 is acceptable only with a priced, funded rollover keeping coverage continuous to that date";
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toEqual([]);
});

it("rejects continuous-to coverage ending before the supplied horizon", () => {
  const answer = "An expiry before 2026-12-31 is acceptable only with a funded rollover keeping coverage continuous to 2026-11-30.";
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toContain("hedge-expiry-before-protection-horizon");
});

it("does not let a qualified rollover hide a conflicting early-expiry assertion after contrast", () => {
  const answer = "An expiry before 2026-12-31 is acceptable only with a funded rollover maintaining continuous coverage through 2026-12-31, but choose an expiry before 2026-12-31.";
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toContain("hedge-expiry-before-protection-horizon");
});

it("allows the retained explicit rejection of an early expiry", () => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", "- Confirm horizon: reject any expiry ending before 2026-12-31 unless a funded rollover is explicitly budgeted within USD 600."))
    .toEqual([]);
});

it("keeps an early expiry assertion after a refusal subject to the same check", () => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", "Reject any expiry before 2026-12-31, but choose an expiry before 2026-12-31."))
    .toContain("hedge-expiry-before-protection-horizon");
});

it("does not mistake do-not-reject for a refusal of the early expiry", () => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", "Do not reject any expiry ending before 2026-12-31."))
    .toContain("hedge-expiry-before-protection-horizon");
});

it("allows the retained Nothing-here refusal of executable advice", () => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", "Nothing here is an executable recommendation or current quote.")).toEqual([]);
});

it("does not let a Nothing-here refusal hide a later executable assertion", () => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", "Nothing here is an executable recommendation, but this is an executable recommendation."))
    .toContain("data-limited-framework-promoted-to-executable-recommendation");
});

it("allows the retained only-with funded rollover and resolves its same-date reference", () => {
  const answer = "Option chain + expiry list with coverage through 2026-12-31; any expiry before 2026-12-31 is acceptable only with an explicit funded rollover maintaining continuous coverage through that date";
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toEqual([]);
});

it("does not accept rollover mentions that leave the supplied horizon uncovered", () => {
  const answer = "Choose an expiry before 2026-12-31; funded rollover maintains continuous coverage through 2026-11-30.";
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toContain("hedge-expiry-before-protection-horizon");
});

it("does not resolve that date to the protection horizon when another date is supplied", () => {
  const answer = "Any expiry before 2026-12-31 is acceptable only with funded rollover maintaining continuous coverage through that date, 2026-11-30.";
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toContain("hedge-expiry-before-protection-horizon");
});

it("does not allow an unconditional early expiry merely because rollover coverage is mentioned", () => {
  const answer = "Choose an expiry before 2026-12-31; funded rollover maintains continuous coverage through that date.";
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toContain("hedge-expiry-before-protection-horizon");
});

it("allows the retained falling-knife noun followed by explicit nonclassification", () => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", "Situation class: underwater holding (single cost-basis comparison; no drawdown path supplied, so a falling-knife pattern is not classifiable)"))
    .toEqual([]);
});

it("does not let a refuted falling-knife pattern hide an affirmative classification after contrast", () => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", "A falling-knife pattern is not classifiable, but this holding is falling-knife-like."))
    .toContain("single-loss-observation-promoted-to-falling-knife");
});

it.each(["Expiry is 2026-12-31.", "到期日为 2026-12-31。"])("rejects an invented listed expiry even when it equals the protection horizon: %s", answer => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toContain("unsupplied-option-contract-invented");
});

it("does not treat an expiry constraint as evidence that a contract is listed", () => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", "需要到期日在 2026-12-31 或之后的已上市合约；本例未提供期权链，具体到期日未知。")).toEqual([]);
});

it("binds the expiry direction to the supplied horizon rather than a fixed report date", () => {
  const answer = "Choose an expiry on or before 2030-06-30.";
  expect(hedgeFrameworkClaimViolations(answer, "2030-06-30")).toEqual(["hedge-expiry-before-protection-horizon"]);
  expect(hedgeFrameworkClaimViolations(answer, "2026-12-31")).toEqual([]);
});

it.each([
  "拉取 HEDG 期权链，到期日需在 2026-12-31 或之前；记录行权价和买价/卖价溢价。",
  "Choose an expiry on or before 2026-12-31 to protect through that horizon.",
])("rejects an early expiry constraint without continuous coverage: %s", answer => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toContain("hedge-expiry-before-protection-horizon");
});

it.each([
  "到期日需在 2026-12-31 或之后，才能覆盖该保护期限。",
  "Do not choose an expiry before 2026-12-31 without a rollover plan.",
  "若到期日早于 2026-12-31，必须有已确认的滚动方案持续保护至 2026-12-31；本例未提供，因此不选择提前到期。",
])("allows horizon coverage, refusals and explicit conditional rollovers: %s", answer => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toEqual([]);
});

it.each([
  "将溢价转换为每份合约的总美元成本；对比 USD 600 总额 / USD 3.00 每股进行测试。",
  "Compare the per-contract cost with the USD 600 total / USD 3.00 per-share budget.",
])("rejects reversed mixed-unit budget instructions: %s", answer => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toContain("contract-cost-compared-to-per-share-budget");
});

it.each([
  "每份合约的总成本乘以合约数量，得到总对冲成本，与 USD 600 总预算比较；每股溢价则与 USD 3.00 每股预算比较。",
  "先将每份合约的总美元成本除以实际合约乘数，换算为每股溢价，再对比 USD 3.00 每股预算。",
  "不能把每份合约的成本与 USD 3.00 每股预算比较；合约乘数未知，换算被阻塞。",
])("keeps separately normalized budgets and refusals valid: %s", answer => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toEqual([]);
});

it.each([
  "+10%  46.20  9,240  +840  -760  collar cap / call leg binds",
  "Back to cost  50.00  10,000  +1,600  0  collar cap would limit this leg",
])("rejects a fixed-price cap assertion without a supplied call strike: %s", answer => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toContain("unsupplied-strike-promoted-to-scenario-cap");
});

it.each([
  "Collar caps upside above its call strike; the strike is unknown.",
  "+10%  46.20  9,240  +840  -760  collar cap only if the unknown call strike is below this price",
  "+10%  46.20  9,240  +840  -760  hedge effect unquantifiable without chain",
])("allows generic or explicitly conditional cap explanations: %s", answer => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toEqual([]);
});

it.each([
  "将每份合约的 put 成本与 USD 3.00/share 的预算上限进行比较。",
  "Compare cost per contract with USD 3.00/share budget.",
])("rejects contract cost compared directly to a per-share budget: %s", answer => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toContain("contract-cost-compared-to-per-share-budget");
});

it.each([
  "先将每份合约的 put 成本除以合约乘数，换算为每股成本，再与 USD 3.00/share 的预算上限进行比较。",
  "Divide cost per contract by its actual multiplier before comparing with the per-share budget.",
  "合约乘数和价格未提供，不能将每份合约的 put 成本与 USD 3.00/share 的预算上限直接比较。",
])("allows normalized comparisons and refusals: %s", answer => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toEqual([]);
});
