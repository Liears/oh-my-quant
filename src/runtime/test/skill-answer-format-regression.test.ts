import { expect, test } from "bun:test";
import { checkSkillEvaluationAnswer, knownSkillAnswerViolations } from "../evaluation/skill-evaluation-answer.ts";

test.each([
  "范围并非完整的 SEC 申报人宇宙 (Full SEC filer universe)。",
  "范围不是完整 SEC 申报人宇宙（Full SEC filer universe）。",
  "无法与完整的 SEC 申报人宇宙进行比较。",
  "无法与完整 SEC 申报人宇宙进行比较。",
  "针对 NIMB 发行人的完整 SEC 申报人宇宙对比 — 需要范围外的数据。",
  "完整 SEC 申报人宇宙对比：未提供相关输入。",
])("keeps a bilingual coverage denial or missing comparison input distinct from coverage: %s", text => {
  expect(knownSkillAnswerViolations("skill-data-holders", text)).toEqual([]);
});

test.each([
  "该列表覆盖完整的 SEC 申报人宇宙。",
  "该列表覆盖完整的 SEC 申报人宇宙 (Full SEC filer universe)。",
  "The list covers the full SEC filer universe.",
  "所需的完整 SEC 申报人宇宙现已涵盖。",
  "完整 SEC 申报人宇宙已经提供，但后续还需要更多输入。",
  "无法与完整 SEC 申报人宇宙进行比较，但此列表覆盖全部 SEC 申报人。",
])("still rejects affirmative coverage, including a later assertion after a denial: %s", text => {
  expect(knownSkillAnswerViolations("skill-data-holders", text)).toContain("top-1000-promoted-to-full-sec-universe");
});

test("coverage formatting changes do not weaken ownership and short-position boundaries", () => {
  expect(knownSkillAnswerViolations("skill-data-holders", "Current institutional holders: Meridian Capital."))
    .toContain("historical-13f-promoted-to-current-ownership");
  expect(knownSkillAnswerViolations("skill-data-holders", "未上榜说明做空。"))
    .toContain("13f-absence-promoted-to-short-or-zero");
});

test.each([
  "未上榜不是做空或零持仓的证据。",
  "Not listed is not proof of a short position or zero ownership.",
  "未上榜不能证明做空，但未上榜说明做空。",
])("keeps denial separate from a later actual absence implication: %s", text => {
  const violations = knownSkillAnswerViolations("skill-data-holders", text);
  expect(violations).toEqual(text.includes("但") ? ["13f-absence-promoted-to-short-or-zero"] : []);
});

const macro = "用户提供的合成组合 TLT 35%, XLE 25%, SPY 40%; 10Y+50 bp; 2026-09-17 快照，2026-09-18 报告。缺少响应系数，只读，无外部查询。";
test.each([
  "oil+15%; DXY+5%",
  "oil +15%; DXY +5%",
  "油价 +15%; DXY 相对 +5%",
  "原油+15%; DXY+5%",
  "oil +15.00%; DXY +5.0%",
])("matches a label-bound supplied shock regardless of legitimate spacing/translation: %s", shocks => {
  expect(checkSkillEvaluationAnswer("skill-macro-portfolio-impact", macro + shocks))
    .toEqual({ evidence: true, dates: true, boundary: true, noMutation: true });
});

test.each([
  "oil+25%; DXY+5%",
  "oil+15%; DXY-5%",
  "oil+15%; another variable +5%",
  "oil+150%; DXY+50%",
  "oil+15 USD; DXY+5 bp",
])("does not accept a wrong shock, sign or absent DXY label: %s", shocks => {
  expect(checkSkillEvaluationAnswer("skill-macro-portfolio-impact", macro + shocks).evidence).toBe(false);
});

test.each(["许可延期", "许可延误", "许可延迟"])("keeps the supplied permitting-delay event across equivalent wording: %s", event => {
  const text = `用户提供的 Grid Modernization: GRID +8%, PWRX +3%, COPR -2%, 各 1/3；变电站合同 2026-09-12，${event} 2026-09-10。快照 2026-09-17，报告 2026-09-18。缺少工作区，只读。`;
  expect(checkSkillEvaluationAnswer("skill-portfolio-theme", text).evidence).toBe(true);
  expect(checkSkillEvaluationAnswer("skill-portfolio-theme", text.replace(event, "未知事件")).evidence).toBe(false);
});

test("a labelled PE percentile accepts percentage notation without accepting an unlabelled PE multiple", () => {
  const text = "用户提供 VELA USD 74, trailing PE 24.0, 五年 PE 百分位: 68%; 增长 11%, 毛利率 47%, ROE 16%, 客户 38%, 产品延迟；2026-09-18, 2026-09-17, 2026-09-05, 2026-08-07, 2026-06-30。缺少工作区，只读。";
  expect(checkSkillEvaluationAnswer("skill-portfolio-profile", text).evidence).toBe(true);
  expect(checkSkillEvaluationAnswer("skill-portfolio-profile", text.replace("五年 PE 百分位: 68%", "额外 PE 倍数 68")).evidence).toBe(false);
});

test("a missing-field header qualifier does not become a current-price assertion or hide an active alert", () => {
  const text = "- Missing (flagged per guardrails): live/current prices, volume/liquidity, active alert inventory.";
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", text)).toEqual([]);
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", text + "\nCurrent price is USD 71.\nBETA alert is active."))
    .toEqual(["close-based-watchlist-promoted-to-current", "missing-alert-inventory-promoted-to-active-alert"]);
});
