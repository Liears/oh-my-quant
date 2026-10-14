import { expect, it } from "bun:test";
import { knownSkillAnswerViolations } from "../evaluation/skill-evaluation-answer.ts";

it.each([
  "Active alert 列全部为 not supplied：未提供任何告警清单；BETA 的 call-flow 标记是观察标记，不计入该列，也不视为已激活告警。",
  "Active alert 列均为 unknown；未提供告警清单。",
  "Active alert 列：未提供。",
  "Active alert 列全部为 not provided。",
  "未提供且未获取：实时/现价、成交量、AURX 与 CYGN 期权数据、事件来源元数据、active alert 清单、score history、更晚观察、watchlist 存储。",
  "Active alert 清单：未提供。",
])("does not promote a qualified Chinese alert-column label to an activation claim: %s", answer => {
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", answer)).toEqual([]);
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", answer + "\nBETA alert is active."))
    .toContain("missing-alert-inventory-promoted-to-active-alert");
});

it.each([
  "Active alert 列全部为 active。",
  "Active alert 列：BETA unusual call-flow flag。",
  "Active alert 列全部为 not supplied；但 BETA alert is active。",
  "Active alert 列全部为 not supplied。然而警报已激活。",
  "告警已经激活。",
  "警报当前已生效。",
  "Active alert 清单：BETA 告警已激活。",
])("retains affirmative or mixed alert claims after a qualified label: %s", answer => {
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", answer))
    .toContain("missing-alert-inventory-promoted-to-active-alert");
});

it.each(["不能说告警已经激活。", "并非警报当前已生效。"])("retains explicit denials of localized activation claims: %s", answer => {
  expect(knownSkillAnswerViolations("skill-portfolio-watchlist", answer)).toEqual([]);
});

it.each([
  "不构成可执行建议，不提供具体合约，不提供实时报价。",
  "不构成可执行对冲。",
  "并不构成 可执行建议。",
  "Nothing here is an executable recommendation or current quote.",
])("does not promote an exact refusal to executable advice: %s", answer => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer)).toEqual([]);
});

it.each([
  "不构成可执行建议，但这就是可执行建议。",
  "不构成可执行建议，这是可执行建议。",
  "Nothing here is an executable recommendation, but this is an executable recommendation.",
  "Nothing here is an executable recommendation, this is an executable recommendation.",
  "不构成 可执行对冲；立即执行对冲。",
])("does not let an exact refusal conceal a separate executable assertion: %s", answer => {
  expect(knownSkillAnswerViolations("skill-risk-hedge", answer))
    .toContain("data-limited-framework-promoted-to-executable-recommendation");
});
