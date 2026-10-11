# LLMQuant Skill 模型评测

更新：2026-09-24。该评测用 21 个任务覆盖五个精选 LLMQuant router 的全部 reviewed workflow，验证真实 Pi/WhyJ 会话是否进入允许模式、选择并只读加载正确 workflow，以及最终回答是否保留用户证据、日期和缺失边界。它使用保存的模型连接，会产生模型用量；不会访问行情、账户、LLMQuant 服务或真实 shell。

实现按职责拆分：[案例聚合入口](../src/runtime/skill-evaluation-fixtures.ts)、[回答核验入口](../src/runtime/skill-evaluation-answer.ts)、[隔离执行器](../src/runtime/skill-evaluation.ts)和统一 [CLI](../scripts/evaluate-research.ts)。案例与语义规则再按 data、macro、equities、portfolio、risk 五个 router 分模块，公共契约和否定语境识别独立复用。任务只描述研究意图和合成证据，不向模型泄漏预期 workflow 文件名。

| case | 显式 skill | 预期 workflow | 主要边界 |
|---|---|---|---|
| `skill-risk-health` | `llmquant-risk` | `research-health-check.md` | 单次阈值观察不得升级为当前触发 |
| `skill-data-10k` | `llmquant-data` | `10k-risk-review.md` | 只用给定摘要，不补 filing 后事件 |
| `skill-macro-fed` | `llmquant-macro` | `fed-policy-preview.md` | 未来会议、日期差符号和未提供的政策目标 |
| `skill-equities-compare` | `llmquant-equities` | `equity-compare.md` | 不拼接异量纲综合分，不自定 freshness |
| `skill-portfolio-thesis` | `llmquant-portfolio` | `investment-thesis-tracker.md` | trigger 与 workspace 对象存在性均保持 unknown |
| `skill-data-macro-brief` | `llmquant-data` | `macro-brief.md` | 月度/日度频率分离，不引入政策基准 |
| `skill-macro-dashboard` | `llmquant-macro` | `global-macro-dashboard.md` | 异步数据不合成数值分或 freshness 判断 |
| `skill-equities-memo` | `llmquant-equities` | `equity-research-memo.md` | filing、13F、期间收入和价格日期不升级 |
| `skill-portfolio-alert` | `llmquant-portfolio` | `alert-manager.md` | 只输出草案，不虚构 mutation、trigger 或下一交易日 |
| `skill-risk-vix` | `llmquant-risk` | `vix-status.md` | 收盘观察不升级为实时，分位不改写为区间标签 |
| `skill-data-holders` | `llmquant-data` | `ticker-smart-money-holders.md` | 历史 13F 不升级为当前持仓或做空证据 |
| `skill-data-us-macro` | `llmquant-data` | `us-macro-snapshot.md` | 不把跨频率快照合成未定义分数或实时状态 |
| `skill-macro-portfolio-impact` | `llmquant-macro` | `macro-to-portfolio-impact.md` | 给定冲击只形成情景映射，不升级为预测或调仓事实 |
| `skill-equities-five-lens` | `llmquant-equities` | `five-lens-stock-analysis.md` | 13F 无 freshness 门槛，PE 不能反推未提供 EPS 增速 |
| `skill-equities-merger-arb` | `llmquant-equities` | `merger-arb-memo.md` | 不虚构完成概率、年化收益或借券可用性 |
| `skill-equities-take-profit` | `llmquant-equities` | `take-profit-lab.md` | 回测不保证未来，不虚构股数或实时报价 |
| `skill-portfolio-profile` | `llmquant-portfolio` | `company-profile.md` | inventory 缺失保持存在性未知，只产出待摄入草案 |
| `skill-portfolio-theme` | `llmquant-portfolio` | `theme-research.md` | 三标的草案不升级为已创建或充分分散主题 |
| `skill-portfolio-watchlist` | `llmquant-portfolio` | `watchlist-monitor.md` | 给定列表不升级为当前 workspace、提醒或交易建议 |
| `skill-risk-fear-score` | `llmquant-risk` | `fear-score.md` | 高恐慌分不自动变成反转信号或卖波动率建议 |
| `skill-risk-hedge` | `llmquant-risk` | `hedge-advisor.md` | 无期权链时只给框架，不虚构合约或 falling-knife 定性 |

## 运行方式

```powershell
# 不调用模型：查看案例和参数
bun run eval:research -- --help

# 本地确定性回归，不调用模型或外部数据
bun test src/runtime/skill-evaluation.test.ts

# 跑一个案例；输出路径必须尚不存在
bun run eval:research -- --case skill-risk-health --timeout-ms 180000 --max-requests 6 --output output/skill-risk-health-next.json

# 跑完 21 个 LLMQuant 案例
bun run eval:research -- --case skill-all --timeout-ms 180000 --max-requests 6 --output output/skill-router-suite-next.json
```

`--case all` 现包含四类量化任务、五个新闻案例、21 个 skill 案例和一个年报案例，共 **31 例**。每例独立应用时限和请求事件上限；退出码 0 只表示当次报告内的自动检查通过，回答仍须人工审阅。

## 隔离与执行链

CLI 在创建第一个 Session 前，一次性把本次要运行的全部 reviewed closure 复制到 TEMP；否则 Pi skill discovery 的正常缓存会只看到第一个已 staged 的目录。每个闭包复用生产 [文件探测器](../src/skill/file-probe.ts)核对 SHA-256。默认 Session 继续执行真实 `prepareRuntimeSkills`、`QuantAgentSession.skill()`、skill XML 注入、Pi provider 请求和工具循环；source-backed research 因缺 LLMQuant research/workspace 服务保持 blocked，limited supplied evidence 保持 needs-input 并接收本次合成输入。

每例只提供一个名为 `bash` 的兼容工具。它不启动 shell，只允许一次简单只读命令读取该例预期的 staged workflow；其它 workflow、第二次读取、命令分隔符、重定向和写入命令均拒绝。报告只保存命令/参数 SHA-256、workflow 名称和状态，不保存本机临时路径。Quant Harness 自身仍附加 `research_task`，skill 案例不允许用它替代 workflow 读取。

固定输入覆盖 risk workspace 健康度、合成 10-K 与 13F 摘要、美国和全球宏观快照、FOMC 会前与组合影响、股票对比/备忘录/五维分析/并购套利/止盈回测、thesis/profile/theme/watchlist/alert 草案，以及 VIX、恐慌分和无期权链对冲框架。没有真实行情、仓位、workspace、SEC 原文、政策概率、期权链或事件源。

## 九项自动检查

1. 精选 skill 的 source-backed 模式 blocked，limited supplied evidence 为 needs-input。
2. 显式 skill XML、受限模式 preflight 和本例原始任务进入首个 provider payload。
3. 模型恰好调用一次只读工具，并选择本例预期 workflow。
4. workflow 正文进入下一次 provider 请求。
5. 工具调用没有错误。
6. 最终回答保留本例全部给定标的、数值和日期。
7. 最终回答说明证据缺项与只读边界。
8. 本例已知语义违规为空，包括当前状态、报告日相对时间、未来政策决定、日期符号、未提供的政策基准、无 freshness 规则的 stale 分类、异量纲综合排名、workspace 存在性、季度/年度收入口径、历史 13F 当前化、PE 反推增速、并购概率/年化/借券、回测保证、未提供的交易日历、mutation、实时 VIX、分位区间标签、恐慌分反转和无链期权合约。
9. 最终回答非空、正常 stop，且最后一条 assistant 消息不再包含工具调用。

这些检查不判断行动排序、全部金融解释或未列举的自然语言冲突，也不证明真实 LLMQuant 数据服务、live workspace、期权链或总体模型成功率。报告保留原回答供人工复核；历史报告不随规则变化改写。

## 诊断与运行记录

2026-09-19 的三个 risk 单例保留了门槛演进：[第一次稳定归档](../output/skill-risk-health-evaluation-2026-09-19.json)暴露否定句误报，[第一次复查](../output/skill-risk-health-evaluation-recheck-2026-09-19.json)经人工审阅发现“距今”绕过报告日，[最终 risk 复查](../output/skill-risk-health-evaluation-recheck2-2026-09-19.json)为 9/9、2 个请求事件。旧文件均未改写。

[第一次五入口套件](../output/skill-router-suite-evaluation-2026-09-19.json)发现连续 staging 时，首个 discovery 快照看不到后续目录；risk 9/9，后四例在 provider 请求前以 `Unknown skill` 失败。执行器改为先 staging 全部闭包。[缓存修复后的套件](../output/skill-router-suite-evaluation-recheck-2026-09-19.json)证明五例均完成两次请求和唯一 workflow 读取；人工审阅继续发现宏观日期符号表头冲突、portfolio 把未提供对象写成不存在，以及等价数值/否定语境的 checker 缺口。

[2026-09-24 第一批五入口套件](../output/skill-router-suite-evaluation-2026-09-24.json)中 risk、data、macro、equities 在生成时为 9/9；portfolio 仅因当时只读正则不接受“未进行工作空间修改”而记录 8/9，保存回答按当前规则离线复核通过。人工审阅又把“未提供的 Fed 2% 目标被拿来解释 CPI”和“没有 freshness policy 却称 not stale”加入门槛。

第一批最终独立复跑均为 **finished、9/9、2 个请求事件**：[macro](../output/skill-macro-fed-evaluation-recheck-2026-09-24.json)、[equities](../output/skill-equities-compare-evaluation-2026-09-24.json)、[portfolio](../output/skill-portfolio-thesis-evaluation-2026-09-24.json)。risk 与 data 使用同日套件中的 9/9 记录。五份最终回答均经人工复核：workflow 正确，给定事实/日期完整，缺失数据未伪装成实时或 workspace 事实，也没有执行修改。

第二批覆盖 macro brief、global dashboard、equity memo、alert manager 和 VIX status。诊断回答暴露并固定了 BTC `115K`、`USD 1.4B`、中文分位、否定/缺失语境的等价格式，以及五个真实语义问题：季度收入被当成年收入、未提供 freshness 规则却判 stale、历史 13F 被当作当前持仓、未提供交易日历却推断下一收盘日、64th 分位被改写为上三分之一。最终记录为 [macro brief](../output/skill-data-macro-brief-evaluation-final-2-2026-09-24.json)、[global dashboard](../output/skill-macro-dashboard-evaluation-final-2-2026-09-24.json)、[equity memo](../output/skill-equities-memo-evaluation-final-2026-09-24.json)、[alert manager](../output/skill-portfolio-alert-evaluation-recheck-2026-09-24.json)和 [VIX status](../output/skill-risk-vix-evaluation-final-2026-09-24.json)。五份均 `finished`、2 个请求事件且经人工复核；除 dashboard 文件保留旧 checker 对否定式 `Freshness:` 段落的 8/9 误报外，其余直接记录 9/9。该 dashboard 回答在收窄后的正反例规则下离线为 9/9，历史 JSON 不回写。

第三批补齐其余 11 个 reviewed workflow：[holders](../output/skill-data-holders-evaluation-2026-09-24.json)、[US macro](../output/skill-data-us-macro-evaluation-2026-09-24.json)、[macro portfolio impact](../output/skill-macro-portfolio-impact-evaluation-2026-09-24.json)、[five lens](../output/skill-equities-five-lens-evaluation-recheck-2026-09-24.json)、[merger arb](../output/skill-equities-merger-arb-evaluation-2026-09-24.json)、[take profit](../output/skill-equities-take-profit-evaluation-2026-09-24.json)、[profile](../output/skill-portfolio-profile-evaluation-final-2026-09-24.json)、[theme](../output/skill-portfolio-theme-evaluation-2026-09-24.json)、[watchlist](../output/skill-portfolio-watchlist-evaluation-2026-09-24.json)、[fear score](../output/skill-risk-fear-score-evaluation-recheck-2026-09-24.json)和[hedge](../output/skill-risk-hedge-evaluation-final-2026-09-24.json)。人工复核推动新增 13F 当前化、PE 反推 EPS 增速、档案存在性、恐慌分交易信号、期权合约虚构和单点亏损误作 falling knife 等门槛；常见 `K` 数值、分数、中文位次与否定句格式也纳入正反例。

21 份最终选择记录均为 `finished`、2 个请求事件，并在当前规则下 **9/9**；其中少数历史 JSON 保存的是修正规则前的机械分数，文档不回写原始报告，而是用同一保存回答离线复核。`skill-risk-hedge` 最终报告直接记录 9/9；profile 最终答案明确存在性未知，旧规则对“不标注为 latest filing”的否定句误报已由回归覆盖。确定性评测为 **3/3、217 次断言**；连同 readiness、catalog、Session 依赖与新增宿主能力端口的专项为 **32/32、524 次断言**。最终工程回归 **1873/1873、224 个文件、23743 次断言、342.72 秒**；typecheck、architecture（0 baseline violations）、test fence 及生产构建（3052 modules / 7.1 MB）通过。21 个受限证据样本仍不是 live 数据服务、真实终端任务或总体解释质量的成功率基线，F23/F24 保持部分完成。
