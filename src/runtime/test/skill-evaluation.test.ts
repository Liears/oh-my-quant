import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { checkSkillEvaluationAnswer, createSkillWorkflowReader, knownSkillAnswerViolations, SKILL_EVALUATION_CASES,
  skillEvaluationCase, type SkillEvaluationCase } from "../evaluation/skill-evaluation.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-skill-evaluation-") || within.includes(sep)) throw new Error("Unsafe skill evaluation fixture cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

function workflowFixture() {
  const root = mkdtempSync(join(tmpdir(), "whyj-skill-evaluation-")); roots.push(root);
  const workflow = join(root, "workflows", "research-health-check.md");
  mkdirSync(join(root, "workflows"), { recursive: true });
  writeFileSync(workflow, "# Research Health Check\n\n## Output Format\n\n1. Overall Score\n", "utf8");
  return { root, workflow };
}

describe("skill model evaluation", () => {
  it("routes every reviewed workflow across five curated skills without leaking expected filenames into their tasks", () => {
    expect(SKILL_EVALUATION_CASES).toEqual([
      "skill-risk-health", "skill-data-10k", "skill-macro-fed", "skill-equities-compare", "skill-portfolio-thesis",
      "skill-data-macro-brief", "skill-macro-dashboard", "skill-equities-memo", "skill-portfolio-alert", "skill-risk-vix",
      "skill-data-holders", "skill-data-us-macro", "skill-macro-portfolio-impact", "skill-equities-five-lens",
      "skill-equities-merger-arb", "skill-equities-take-profit", "skill-portfolio-profile", "skill-portfolio-theme",
      "skill-portfolio-watchlist", "skill-risk-fear-score", "skill-risk-hedge",
    ]);
    expect(SKILL_EVALUATION_CASES.map(id => skillEvaluationCase(id).skill)).toEqual([
      "llmquant-risk", "llmquant-data", "llmquant-macro", "llmquant-equities", "llmquant-portfolio",
      "llmquant-data", "llmquant-macro", "llmquant-equities", "llmquant-portfolio", "llmquant-risk",
      "llmquant-data", "llmquant-data", "llmquant-macro", "llmquant-equities", "llmquant-equities",
      "llmquant-equities", "llmquant-portfolio", "llmquant-portfolio", "llmquant-portfolio", "llmquant-risk", "llmquant-risk",
    ]);
    for (const id of SKILL_EVALUATION_CASES) {
      const fixture = skillEvaluationCase(id), filename = fixture.workflow.split("/").at(-1)!;
      expect(fixture.prompt).not.toContain(fixture.workflow);
      expect(fixture.prompt).not.toContain(filename);
      expect(fixture.prompt).toContain("report date: 2026-09-18");
      expect(fixture.injectionNeedles.every(needle => fixture.prompt.includes(needle))).toBeTrue();
    }
  });

  it("returns only the selected workflow through a read-only bash-compatible port", async () => {
    const { workflow } = workflowFixture();
    const reader = createSkillWorkflowReader(workflow);
    const result = await reader.tool.execute("call-1", { command: `Get-Content -Raw -LiteralPath '${workflow}'` });
    expect(result.content[0]).toEqual({ type: "text", text: expect.stringContaining("# Research Health Check") });
    expect(result.details).toMatchObject({ evaluation: true, readOnly: true, workflow: "workflows/research-health-check.md" });
    expect(reader.trace.reads).toEqual([{ commandHash: createHash("sha256").update(`Get-Content -Raw -LiteralPath '${workflow}'`).digest("hex"),
      workflow: "workflows/research-health-check.md", status: "accepted" }]);

    await expect(reader.tool.execute("call-2", { command: "Get-Content workflows/hedge-advisor.md" })).rejects.toThrow("Only one simple read");
    await expect(reader.tool.execute("call-3", { command: `Get-Content '${workflow}'; Remove-Item '${resolve(workflow)}'` })).rejects.toThrow("Only one simple read");
    await expect(reader.tool.execute("call-4", { command: `Get-Content -Raw '${workflow}'` })).rejects.toThrow("Only one simple read");
    expect(reader.trace.reads.map(read => read.status)).toEqual(["accepted", "rejected", "rejected", "rejected"]);
  });

  it("checks supplied facts, observation dates, evidence limits and no-mutation wording independently", () => {
    const answers: Readonly<Partial<Record<SkillEvaluationCase, string>>> = {
      "skill-risk-health": `本回答只依据用户提供的合成快照，报告日 2026-09-18，整体 62/100。AAPL 最后更新 2026-05-01；
NVDA 最新给定毛利率 68%，观察日 2026-09-17；China EV 无关联标的；MSFT 缺少提醒。未提供实时价格、权重或期权链，本次未执行任何修改。`,
      "skill-data-10k": `只依据用户提供的合成 ACME 10-K：accession 0000000000-26-000042，filed 2026-02-20，period 2025-12-31，报告日 2026-09-18。Northstar 占 61%，毛利率由 43% 降至 37%，capex USD 120 million。缺少其它段落和实时资料，本次未执行外部查询或修改。`,
      "skill-macro-fed": `只依据用户提供的合成快照，报告日 2026-09-18，FOMC meeting 为 2026-09-23。目标区间 4.25%-4.50%（2026-09-17），CPI 2.8%（2026-09-11），失业率 4.3%（2026-09-04），2Y 4.12%、DXY 101.6（2026-09-17）。未提供概率或共识，本次未执行外部查询或修改。`,
      "skill-equities-compare": `只依据用户提供的 2026-09-17 合成数据，报告日 2026-09-18：AAPL PE 31.2、ROIC 41%、60日收益 8%、波动 22%；MSFT PE 34.7、ROIC 35%、60日收益 5%、波动 19%。未提供实时价格和其它证据，本次未执行外部查询或修改。`,
      "skill-portfolio-thesis": `只依据用户提供的合成 ORBT 草案，报告日 2026-09-18、观察日 2026-09-17：续费率 94%、毛利率 72%；卖出条件为毛利率低于 65%、NRR 低于 88% 或 product recall。未提供 workspace 与实时资料，本次未执行写入或修改。`,
      "skill-data-macro-brief": `只依据用户提供的合成快照，报告日 2026-09-18。月度 CPI 2.8%（2026-09-11）和 2.9%（2026-08-12）；月度失业率 4.3%（2026-09-04）和 4.2%（2026-08-07）。日度收盘观察为 2Y 4.12%、SPY 660、BTC 115K，日期 2026-09-17。未供应实时资料或政策概率，本次无任何写入或变更。`,
      "skill-macro-dashboard": `只依据用户提供的合成 dashboard，报告日 2026-09-18：季度 GDP 2.2%，期间截止 2026-06-30、发布 2026-08-27；月度 CPI 2.8% 发布 2026-09-11，失业率 4.3% 发布 2026-09-04；M2 21.7，观察 2026-07-31、发布 2026-08-25。2026-09-17 收盘数据为 10Y 4.32%、2Y 4.12%、SPY 660、DXY 101.6、铜 4.65。缺少其它指标，本次未执行外部查询或修改。`,
      "skill-equities-memo": `只依据用户提供的 AURX 合成快照，报告日 2026-09-18。10-Q accession 0000000000-26-000077，filed 2026-08-08，period 2026-06-30；revenue USD 820 million、同比 18%，毛利率 58% 到 61%，backlog USD 1.4B，客户占比 32%。收盘区间 2026-08-18 至 2026-09-17 为 44 到 39。2026 Q2 13F：Northbridge 4.2 million、Atlas 3.6 million。未提供实时资料，本次未执行外部查询或修改。`,
      "skill-portfolio-alert": `只依据用户提供的 AURX 草案，报告日 2026-09-18。条件为 price below USD 35，每日收盘检查，过线通知一次，2026-12-31 到期。给定最后收盘 USD 39，观察日 2026-09-17。未提供 alert inventory、当前价格或 workspace，本次未执行外部查询或修改。`,
      "skill-risk-vix": `只依据供应的收盘快照，报告日 2026-09-18、观察日 2026-09-17。VIX 21.4、日变动 +1.8、1 年第 64 百分位；front 21.4、second 20.6、spread +0.8，breadth 43%。缺失盘中数据、历史 tier 分布或仓位，本次未执行外部查询或修改。`,
    };
    for (const id of SKILL_EVALUATION_CASES) {
      const answer = answers[id] ?? skillEvaluationCase(id).prompt;
      expect(checkSkillEvaluationAnswer(id, answer)).toEqual({ evidence: true, dates: true, boundary: true, noMutation: true });
      expect(checkSkillEvaluationAnswer(id, "Evidence needs review.")).toEqual({ evidence: false, dates: false, boundary: false, noMutation: false });
      if (answers[id]) expect(knownSkillAnswerViolations(id, answer)).toEqual([]);
    }
    expect(knownSkillAnswerViolations("skill-risk-health", "因此该触发条件实时生效。")).toEqual(["supplied-observation-promoted-to-current-state"]);
    expect(knownSkillAnswerViolations("skill-risk-health", "The supplied observation is still triggered.")).toEqual(["supplied-observation-promoted-to-current-state"]);
    expect(knownSkillAnswerViolations("skill-risk-health", "不能视为当前生效触发，之后状态未知。")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-risk-health", "Do not describe it as currently active.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-risk-health", "2026-09-17 之后是否仍触发未经任何数据验证。")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-macro-fed", "美联储已经决定降息。")).toEqual(["future-policy-meeting-promoted-to-known-decision"]);
    expect(knownSkillAnswerViolations("skill-macro-fed", "美联储尚未决定，结果未知。")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-macro-fed", "报告日期前(+)后(-) 天数\n2026-09-17 -1\n2026-09-23 +5")).toEqual(["relative-date-sign-label-conflict"]);
    expect(knownSkillAnswerViolations("skill-macro-fed", "event date minus report date\n2026-09-17 -1\n2026-09-23 +5")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-macro-fed", "CPI 2.8% 仍高于 FOMC 的 2% longer-run objective。")).toEqual(["unsupplied-fed-objective-used"]);
    expect(knownSkillAnswerViolations("skill-macro-fed", "No inflation target was supplied, so CPI is not compared with one.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-macro-fed", "通胀目标/长期目标明确未供，未引入任何 2% 假设。")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-equities-compare", "Observations are one day old and not stale.")).toEqual(["unsupplied-freshness-classification"]);
    expect(knownSkillAnswerViolations("skill-equities-compare", "Observations are one day before the report; no stale threshold was supplied.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-equities-compare", "The composite ranking is AAPL first.")).toEqual(["incommensurate-metrics-promoted-to-composite-ranking"]);
    expect(knownSkillAnswerViolations("skill-equities-compare", "No composite score or ranking is computed.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-portfolio-thesis", "毛利率条件已触发。")).toEqual(["unknown-thesis-trigger-promoted-to-current-state"]);
    expect(knownSkillAnswerViolations("skill-portfolio-thesis", "毛利率条件未触发，实际状态未知。")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-portfolio-thesis", "No thesis inventory or workspace object exists.")).toEqual(["missing-workspace-evidence-promoted-to-nonexistence"]);
    expect(knownSkillAnswerViolations("skill-portfolio-thesis", "No thesis inventory was supplied; whether a workspace object exists is unknown.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-data-10k", "ACME 距今约 200 天没有更新。")).toEqual(["relative-time-without-supplied-as-of"]);
    expect(knownSkillAnswerViolations("skill-data-10k", "截至报告日 2026-09-18 约 200 天没有更新。")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-data-10k", "未使用任何当前日期作为参照。")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-data-macro-brief", "The Fed will certainly cut after this CPI release.")).toEqual(["uncertain-policy-path-promoted-to-certain"]);
    expect(knownSkillAnswerViolations("skill-data-macro-brief", "Monthly CPI is real-time market data.")).toEqual(["monthly-macro-promoted-to-intraday"]);
    expect(knownSkillAnswerViolations("skill-data-macro-brief", "CPI 与失业率为月度数据，并非盘中或实时观测。")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-data-macro-brief", "No certain Fed path can be inferred; CPI is monthly.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-data-macro-brief", "CPI is close to the target area.")).toEqual(["unsupplied-inflation-benchmark-used"]);
    expect(knownSkillAnswerViolations("skill-data-macro-brief", "CPI is reported without a target comparison because no objective was supplied.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-macro-dashboard", "综合宏观评分为 72 分。")).toEqual(["mixed-frequency-inputs-promoted-to-composite-score"]);
    expect(knownSkillAnswerViolations("skill-macro-dashboard", "All supplied indicators were observed on 2026-09-17.")).toEqual(["mixed-frequency-inputs-promoted-to-one-observation-date"]);
    expect(knownSkillAnswerViolations("skill-macro-dashboard", "Inflation is above the 2% area and M2 is stale.")).toEqual([
      "unsupplied-inflation-benchmark-used", "unsupplied-freshness-classification",
    ]);
    expect(knownSkillAnswerViolations("skill-macro-dashboard", "No inflation target or freshness rule was supplied.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-macro-dashboard", "Inflation has no objective for comparison; ages are reported without any fresh or stale judgment.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-macro-dashboard", "M2 and GDP staleness weakens the view.")).toEqual(["unsupplied-freshness-classification"]);
    expect(knownSkillAnswerViolations("skill-macro-dashboard", "M2 is not classified as stale because no threshold was supplied.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-macro-dashboard", "No macro composite score is calculated; frequencies differ.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-equities-memo", "This is the latest 10-Q and Northbridge is a current holder.")).toEqual([
      "supplied-filing-promoted-to-latest", "historical-13f-promoted-to-current-ownership",
    ]);
    expect(knownSkillAnswerViolations("skill-equities-memo", "Price target: USD 55.")).toEqual(["unsupplied-price-target-invented"]);
    expect(knownSkillAnswerViolations("skill-equities-memo", "Backlog is 1.7x annual revenue and the price data is stale.")).toEqual([
      "quarterly-revenue-promoted-to-annual-denominator", "unsupplied-freshness-classification",
    ]);
    expect(knownSkillAnswerViolations("skill-equities-memo", "The supplied 10-Q is not verified as latest; Q2 holders are not current ownership evidence.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-equities-memo", "A current ownership snapshot is missing; no stale threshold was supplied.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-portfolio-alert", "The alert was created and is currently triggered.")).toEqual([
      "draft-alert-promoted-to-mutation", "supplied-alert-observation-promoted-to-current-trigger",
    ]);
    expect(knownSkillAnswerViolations("skill-portfolio-alert", "No alert exists in the workspace.")).toEqual(["missing-alert-workspace-promoted-to-nonexistence"]);
    expect(knownSkillAnswerViolations("skill-portfolio-alert", "The first close not covered by supplied evidence is 2026-09-18.")).toEqual(["unsupplied-next-close-date-invented"]);
    expect(knownSkillAnswerViolations("skill-portfolio-alert", "The draft was not created; current trigger and workspace existence are unknown.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-portfolio-alert", "未创建、保存、更新或删除任何警报；后续收盘日期未知。")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-risk-vix", "Current VIX is 21.4, so we recommend naked short vol.")).toEqual([
      "close-based-vix-promoted-to-current-or-intraday", "uncapped-short-volatility-recommended",
    ]);
    expect(knownSkillAnswerViolations("skill-risk-vix", "The 64th percentile is in the top third of the distribution.")).toEqual(["vix-percentile-promoted-to-top-third"]);
    expect(knownSkillAnswerViolations("skill-risk-vix", "This is not current or intraday VIX and does not support naked short volatility.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-risk-vix", "非盘中或实时 VIX；缺失盘中 VIX。")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-data-holders", "Meridian is a current owner; the list covers the full SEC filer universe.")).toEqual([
      "historical-13f-promoted-to-current-ownership", "top-1000-promoted-to-full-sec-universe",
    ]);
    expect(knownSkillAnswerViolations("skill-data-holders", "Absence means the manager has a short position.")).toEqual(["13f-absence-promoted-to-short-or-zero"]);
    expect(knownSkillAnswerViolations("skill-data-holders", "This is not current ownership and covers only the Top 1000 universe.")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-data-holders", "这是历史视图，而非当前所有权；在该名单中缺席，并不代表存在空头持仓或零所有权。")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-data-us-macro", "This confirms a durable regime change and the Fed will certainly cut.")).toEqual([
      "two-month-snapshot-promoted-to-durable-regime-change", "uncertain-policy-path-promoted-to-certain",
    ]);
    expect(knownSkillAnswerViolations("skill-data-us-macro", "CPI is above the 2% target.")).toEqual(["unsupplied-inflation-benchmark-used"]);
    expect(knownSkillAnswerViolations("skill-macro-portfolio-impact", "The scenario will occur and portfolio loss will be 8%.")).toEqual([
      "qualitative-scenario-promoted-to-quantified-portfolio-impact", "hypothetical-scenario-promoted-to-forecast",
    ]);
    expect(knownSkillAnswerViolations("skill-equities-five-lens", "Price target USD 65, stop price USD 45, confidence 80%.")).toEqual([
      "unsupplied-target-or-stop-price-invented", "unsupplied-confidence-percentage-invented",
    ]);
    expect(knownSkillAnswerViolations("skill-equities-five-lens", "13F ownership is stale; trailing versus forward PE implies 15.8% EPS growth.")).toEqual([
      "unsupplied-freshness-classification", "forward-multiple-promoted-to-unsupplied-eps-growth",
    ]);
    expect(knownSkillAnswerViolations("skill-equities-merger-arb", "Completion probability 75%; annualized return 18%; borrow is available.")).toEqual([
      "unsupplied-deal-probability-invented", "unsupplied-annualized-return-invented", "unsupplied-borrow-availability-invented",
    ]);
    expect(knownSkillAnswerViolations("skill-equities-take-profit", "This universally best rule guarantees future profit; sell 100 shares.")).toEqual([
      "backtest-promoted-to-future-guarantee", "unsupplied-share-count-invented",
    ]);
    expect(knownSkillAnswerViolations("skill-portfolio-profile", "The latest 10-Q was used and the profile was created.")).toEqual([
      "profile-draft-promoted-to-mutation", "supplied-filing-promoted-to-latest",
    ]);
    expect(knownSkillAnswerViolations("skill-portfolio-profile", "Latest price: USD 74.")).toEqual(["close-based-profile-price-promoted-to-latest-or-current"]);
    expect(knownSkillAnswerViolations("skill-portfolio-profile", "不存在工作区档案对象。")).toEqual(["missing-profile-inventory-promoted-to-nonexistence"]);
    expect(knownSkillAnswerViolations("skill-portfolio-profile", "不标注为 latest filing。")).toEqual([]);
    expect(knownSkillAnswerViolations("skill-portfolio-theme", "The theme was created and is well-diversified.")).toEqual([
      "theme-draft-promoted-to-mutation", "three-name-draft-promoted-to-diversified-theme",
    ]);
    expect(knownSkillAnswerViolations("skill-portfolio-watchlist", "BETA was added; the current signal is a buy recommendation.")).toEqual([
      "watchlist-summary-promoted-to-mutation", "close-based-watchlist-promoted-to-current", "watchlist-notification-promoted-to-trade-recommendation",
    ]);
    expect(knownSkillAnswerViolations("skill-risk-fear-score", "The score of 72 is a bullish reversal, so we recommend premium sale.")).toEqual([
      "high-fear-score-promoted-to-bullish-signal", "premium-sale-recommended-without-event-or-liquidity-check",
    ]);
    expect(knownSkillAnswerViolations("skill-risk-hedge", "Buy 2 contracts with strike: USD 40; this is an executable hedge for a falling-knife situation.")).toEqual([
      "unsupplied-option-contract-invented", "data-limited-framework-promoted-to-executable-recommendation",
      "single-loss-observation-promoted-to-falling-knife",
    ]);
    expect(checkSkillEvaluationAnswer("skill-data-10k", answers["skill-data-10k"]!.replace("USD 120 million", "1.2 亿美元"))).toEqual({
      evidence: true, dates: true, boundary: true, noMutation: true,
    });
    expect(checkSkillEvaluationAnswer("skill-portfolio-thesis", answers["skill-portfolio-thesis"]!.replace("未执行写入或修改", "未执行外部查找，未进行工作空间修改"))).toEqual({
      evidence: true, dates: true, boundary: true, noMutation: true,
    });
  });
});
