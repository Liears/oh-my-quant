import { expect, it } from "bun:test";
import { checkSkillEvaluationAnswer, knownSkillAnswerViolations } from "../evaluation/skill-evaluation-answer.ts";

it("does not infer latest filing or price target from a retained refusal and the next section number", () => {
  const answer = "不将其称为“最新申报”（未提供 filing discovery，无法核实是否为最新）。\n未给出目标价——用户未要求且未提供估值假设）\n\n2. Thesis Summary";
  expect(knownSkillAnswerViolations("skill-equities-memo", answer)).toEqual([]);
});

it.each(["This is the latest 10-Q.", "这份就是最新申报。", "不将其称为最新申报，但这份确实是最新申报。"])("still rejects an affirmative latest-filing claim: %s", text => {
  expect(knownSkillAnswerViolations("skill-equities-memo", text)).toContain("supplied-filing-promoted-to-latest");
});

it.each(["Price target: USD 55.", "目标价 USD 55。", "USD 55 price target."])("still rejects an invented inline price target: %s", text => {
  expect(knownSkillAnswerViolations("skill-equities-memo", text)).toEqual(["unsupplied-price-target-invented"]);
});

it("does not turn the next heading into an invented five-lens price", () => {
  expect(knownSkillAnswerViolations("skill-equities-five-lens", "未给出目标价\n2. Evidence")).toEqual([]);
  expect(knownSkillAnswerViolations("skill-equities-five-lens", "Price target USD 65.")).toContain("unsupplied-target-or-stop-price-invented");
});

it("keeps a negated quotation of absent alert inventory distinct from an absence assertion", () => {
  expect(knownSkillAnswerViolations("skill-portfolio-alert", 'existence is currently unknown (no inventory supplied — not "no alert exists")')).toEqual([]);
  expect(knownSkillAnswerViolations("skill-portfolio-alert", "No alert exists.")).toEqual(["missing-alert-workspace-promoted-to-nonexistence"]);
  expect(knownSkillAnswerViolations("skill-portfolio-alert", "警报不存在。")).toEqual(["missing-alert-workspace-promoted-to-nonexistence"]);
});

it("does not let negative grammar within an absence assertion cancel the assertion", () => {
  expect(knownSkillAnswerViolations("skill-portfolio-profile", "No profile exists.")).toEqual(["missing-profile-inventory-promoted-to-nonexistence"]);
  expect(knownSkillAnswerViolations("skill-portfolio-theme", "No theme exists.")).toEqual(["missing-theme-inventory-promoted-to-nonexistence"]);
  expect(knownSkillAnswerViolations("skill-portfolio-thesis", "No company profile exists.")).toEqual(["missing-workspace-evidence-promoted-to-nonexistence"]);
});

it("does not promote a requested SEC input to supplied coverage", () => {
  expect(knownSkillAnswerViolations("skill-data-holders", "- 所需的完整 SEC 申报人股票池对比")).toEqual([]);
  expect(knownSkillAnswerViolations("skill-data-holders", "- required full SEC filer universe comparison")).toEqual([]);
});

it.each([
  "The list covers the full SEC filer universe.",
  "所需的完整 SEC 申报人股票池现已涵盖。",
  "- 所需的完整 SEC 申报人股票池对比\n该样本覆盖全部 SEC 申报人。",
])("keeps actual full-coverage assertions rejected: %s", text => {
  expect(knownSkillAnswerViolations("skill-data-holders", text)).toContain("top-1000-promoted-to-full-sec-universe");
});

it("keeps a missing borrow-availability noun distinct from an availability assertion", () => {
  expect(knownSkillAnswerViolations("skill-equities-merger-arb", "- 对冲的借券可用性和成本（此处未主张）")).toEqual([]);
  expect(knownSkillAnswerViolations("skill-equities-merger-arb", "Borrow is available.")).toContain("unsupplied-borrow-availability-invented");
  expect(knownSkillAnswerViolations("skill-equities-merger-arb", "借券可用。")).toContain("unsupplied-borrow-availability-invented");
  expect(knownSkillAnswerViolations("skill-equities-merger-arb", "借券可用性已确认。")).toContain("unsupplied-borrow-availability-invented");
});

it("rejects the retained offer spread as deal-break downside while allowing its correct label", () => {
  expect(knownSkillAnswerViolations("skill-equities-merger-arb", "若交易破裂，每股风险总价差为 USD 4。"))
    .toContain("offer-spread-promoted-to-deal-break-downside");
  expect(knownSkillAnswerViolations("skill-equities-merger-arb", "The deal-break downside is USD 4 per share."))
    .toContain("offer-spread-promoted-to-deal-break-downside");
  expect(knownSkillAnswerViolations("skill-equities-merger-arb", "报价 48 减观察收盘 44 的价差为 USD 4；交易破裂价格未提供，不能量化下行风险。"))
    .toEqual([]);
});

it("keeps the retained refusal of universal optimality distinct from a guarantee", () => {
  expect(knownSkillAnswerViolations("skill-equities-take-profit", "故 supplied 证据不支持任何单一规则普遍最优。" )).toEqual([]);
  expect(knownSkillAnswerViolations("skill-equities-take-profit", "本规则普遍最优。" )).toContain("backtest-promoted-to-future-guarantee");
  expect(knownSkillAnswerViolations("skill-equities-take-profit", "证据不支持任何单一规则普遍最优，但此规则普遍最优。" ))
    .toContain("backtest-promoted-to-future-guarantee");
});

it.each(["许可延期", "许可延误"])("retains the same supplied permitting-delay event: %s", event => {
  const answer = `用户提供的合成 Grid Modernization 草案：GRID +8%，PWRX +3%，COPR -2%，各 1/3。变电站合同 2026-09-12；${event} 2026-09-10；观察 2026-09-17，报告 2026-09-18。缺少工作区与实时证据，仅只读。`;
  expect(checkSkillEvaluationAnswer("skill-portfolio-theme", answer)).toEqual({ evidence: true, dates: true, boundary: true, noMutation: true });
  expect(checkSkillEvaluationAnswer("skill-portfolio-theme", answer.replace(event, "未知事件")).evidence).toBe(false);
});

it("keeps the original observed call-flow flag in an active-alert column rejected", () => {
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", "Ticker  Active alert\nBETA  unusual call-flow flag (2026-09-17 obs only)\nNo active alert inventory was supplied."))
    .toContain("missing-alert-inventory-promoted-to-active-alert");
});

it.each(["plain", "markdown"] as const)("does not turn a %s header with only unsupplied alert cells into an active-alert assertion", format => {
  const table = format === "plain"
    ? "ticker  close  active alert\nAURX  USD 39  none supplied\nBETA  USD 71  none supplied\nCYGN  USD 28  none supplied"
    : "| ticker | close | active alert |\n| --- | --- | --- |\n| AURX | USD 39 | 未提供 |\n| BETA | USD 71 | 未提供 |\n| CYGN | USD 28 | 未提供 |";
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", table)).toEqual([]);
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", table + "\n\nBETA alert is active."))
    .toContain("missing-alert-inventory-promoted-to-active-alert");
});

it("keeps mixed alert tables rejected even with an explicit missing-inventory disclaimer", () => {
  const table = "ticker  close  active alert\nAURX  USD 39  none supplied\nBETA  USD 71  call-flow flag\nCYGN  USD 28  none supplied\n\nNo active alert inventory was supplied.";
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", table))
    .toContain("missing-alert-inventory-promoted-to-active-alert");
});

it("allows a missing-alert column with a single-space final cell and a nominal column explanation", () => {
  const answer = "Ticker  Close  Next event  Active alert\nAURX  39  none supplied  none supplied\nBETA  71  none supplied  none supplied\nCYGN  28  earnings 2026-09-25 (unverified) none supplied\n\nActive alert column: no active alert inventory was supplied, so no alert can be confirmed active for any ticker. BETA's call-flow flag is a supplied observation flag, not an active alert.";
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", answer)).toEqual([]);
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", answer + "\nBETA alert is active."))
    .toContain("missing-alert-inventory-promoted-to-active-alert");
});
