import { expect, test } from "bun:test";
import { checkSkillEvaluationAnswer, knownSkillAnswerViolations } from "../evaluation/skill-evaluation-answer.ts";

test("negative mutation fields accept the actual response format without concealing a write", () => {
  const text = "外部查询：无；mutations：无（未改动 profiles、alerts）。";
  expect(checkSkillEvaluationAnswer("skill-data-holders", text).noMutation).toBe(true);
  for (const suffix of ["但已保存档案。", "\nI updated the workspace.", "，已执行外部查询。", "\nmutations: yes"]) {
    expect(checkSkillEvaluationAnswer("skill-data-holders", text + suffix).noMutation).toBe(false);
  }
});

test("holder values allow equivalent Chinese units but reject a different amount", () => {
  const text = "NIMB 18家持有人，Top 1000 7.2亿美元；Meridian 520万股 2.6亿美元；Harbor 310万股 1.55亿美元。";
  expect(checkSkillEvaluationAnswer("skill-data-holders", text).evidence).toBe(true);
  expect(checkSkillEvaluationAnswer("skill-data-holders", text.replace("7.2亿", "72亿")).evidence).toBe(false);
});

test("long unused lists do not assert coverage, but independent coverage still fails", () => {
  const text = "未使用：LLMQuant Data 网络功能、实时所有权、历史价格、做空数据、完整 SEC 申报机构范围、流通股、2026-06-30 之后的交易——以上内容均未检索。";
  expect(knownSkillAnswerViolations("skill-data-holders", text)).toEqual([]);
  for (const suffix of ["但已覆盖完整 SEC 申报机构范围。", "\nThe list covers the full SEC filer universe."]) {
    expect(knownSkillAnswerViolations("skill-data-holders", text + suffix)).toContain("top-1000-promoted-to-full-sec-universe");
  }
  expect(knownSkillAnswerViolations("skill-data-holders", "未使用：实时行情，已覆盖完整 SEC 申报机构范围。"))
    .toContain("top-1000-promoted-to-full-sec-universe");
});

test("denial of universal superiority is distinct from an assertion", () => {
  const text = "不宣称任何一条规则 universally best，这是路径依赖。";
  expect(knownSkillAnswerViolations("skill-equities-take-profit", text)).toEqual([]);
  expect(knownSkillAnswerViolations("skill-equities-take-profit", text + "但该规则 universally best。"))
    .toContain("backtest-promoted-to-future-guarantee");
});

test("plural alert headers accept missing cells but reject a mixed table", () => {
  const text = "| Ticker | Active alerts |\n| --- | --- |\n| AURX | not supplied |\n| BETA | not supplied |\n| CYGN | not supplied |";
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", text)).toEqual([]);
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", text.replace("BETA | not supplied", "BETA | active")))
    .toContain("missing-alert-inventory-promoted-to-active-alert");
});

test("a labelled shock combination is not a portfolio impact estimate", () => {
  const text = "冲击组合：10Y 国债收益率 +50 bp，石油 +15%，DXY +5%。";
  expect(knownSkillAnswerViolations("skill-macro-portfolio-impact", text)).toEqual([]);
  for (const suffix of ["组合损失8%。", "预期 portfolio return -8%.", "8% portfolio loss."]) {
    expect(knownSkillAnswerViolations("skill-macro-portfolio-impact", text + suffix))
      .toContain("qualitative-scenario-promoted-to-quantified-portfolio-impact");
  }
});

test("translated ten-year yield labels retain the exact shock and basis-point unit", () => {
  const text = "TLT 35%, XLE 25%, SPY 40%; 10 年期国债收益率 +50 bp，原油 +15%，DXY +5%。";
  expect(checkSkillEvaluationAnswer("skill-macro-portfolio-impact", text).evidence).toBe(true);
  for (const shock of ["+500 bp", "-50 bp", "+50%", "+50 USD"]) {
    expect(checkSkillEvaluationAnswer("skill-macro-portfolio-impact", text.replace("+50 bp", shock)).evidence).toBe(false);
  }
});

test("unexecuted follow-up comparison bullets do not assert available coverage", () => {
  const heading = "5. Follow-Up Checks (not executed; would need data access)\n";
  const item = "  - Full SEC filer universe comparison and post-period amended filings";
  expect(knownSkillAnswerViolations("skill-data-holders", heading + item)).toEqual([]);
  for (const text of [heading + item + " already available", heading + item + "\n\nThe list covers the full SEC filer universe.",
    "Follow-Up Checks\n" + item, heading + "  - Full SEC filer universe comparison is provided"]) {
    expect(knownSkillAnswerViolations("skill-data-holders", text)).toContain("top-1000-promoted-to-full-sec-universe");
  }
});
