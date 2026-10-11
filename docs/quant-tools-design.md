# 内置量化工具设计

> 最后更新：2026-09-16

量化分析以内置工具形式暴露给 agent，而非 slash 命令。用户应以自然语言提问；agent 选择分析工具，工具自身负责获取所需行情。

## 1. 边界

Slash 命令保留用于本地 UI/session 操作，如 `/help`、`/config`、`/portfolio`、`/resume`、`/compact` 和 `/clear`。

量化工作流为 agent 工具：

| 对话标签 | 工具名 | 用途 |
|--------------------|-----------|---------|
| `Quant.Factor` | `compute_factor` | 计算某个 symbol 的单个技术因子。 |
| `Quant.Backtest` | `run_backtest` | 运行 SMA 双均线策略回测。 |
| `Quant.Risk` | `check_risk` | 计算收益分布和回撤风险指标。 |
| `Quant.ArchiveAnalysis` | `analyze_archived_bars` | 用明确日期窗口与应用观察截止前的不可变归档计算因子、SMA 回测或风险。 |
| `Tool.quant.fund.dca` | `fund_dca_backtest` | 基于基金公开 NAV 模拟定投，区分本金收益、TWR 与 XIRR。 |
| `Quant.Benchmark` | `score_benchmark` | 对策略进行 benchmark 评分并保存结果制品。 |
| `Quant.Dashboard` | `show_dashboard` | 读取已保存的 benchmark 制品并展示排名摘要。 |
| `Quant.Portfolios` / `Quant.PortfolioEdit` | `list_portfolios` / `edit_portfolio` | 观察组读取与基于 revision 的用户请求修改。 |
| `Quant.Compare` / `Quant.Comparisons` | `compare_portfolios` / `portfolio_comparisons` | 自动获取价格/NAV/同日汇率，比较两组并保存/重算历史。 |

TUI 应在 Conversation 面板中使用上述名称渲染这些工具调用，例如：

```text
● Quant.Risk · 000300.SH
  ⎿ 年化波动率 18.42% ...
```

## 2. 数据契约

`compute_factor`、`run_backtest`、`check_risk` 和 `score_benchmark` 统一调用 `runtime/analysis-data.ts`：

```text
当前研究 → loadAnalysisBars → runtime.fetchBars → 新鲜缓存 / provider / 标记为陈旧的缓存
显式 observed_before → loadAnalysisBars → runtime.fetchBars → 截止前的单次不可变应用观察归档
```

`compute_factor`、`run_backtest`、`check_risk` 默认仍自动刷新；显式给出 `observed_before` 时，必须同时给 `market`、`start`、`end`，可选 `source`，只读取本应用截至该精确 UTC 时刻保存的一个完整响应，不调用当前 provider 或最新缓存 head。没有符合条件的归档、损坏归档及缺足够行分别返回不同错误。报告、任务和恢复用原 DatasetRef 重算指标并核对截止；证据只说明应用观察时间，不证明供应商当时发布、复权或交易日全集。[专门的历史读取](./data-validation.md#2026-09-15应用观察截止与历史归档读取)和 `analyze_archived_bars` 仍提供独立 `local` 能力入口。

无需手工预取数据。工具按当前市场与 source 配置自动抓取，沿用 5 分钟 freshness 和区间覆盖规则，展示实际 provider、origin 和 asOfDate。未给 start 时，取至少 365 个日历日或所需行数的三倍作为回看窗口；给定 end 时从该日期回推。上游有效样本不足时明确返回数据不足，不编造指标。

因子、回测与风险的 start/end 为闭区间；日期必须有效且 start ≤ end。因子 warmup 也在窗口内，不额外加载窗口外观察。因子周期、SMA 参数必须是正整数，fast < slow，cash > 0。Benchmark 将两条序列都限制到共同交易日期，要求训练/测试窗口都有足够数据。

无可用数据且 provider 返回错误时，分析准备保留来源诊断；正常空数据或样本不足使用结构化 `details.error` 返回 DATA_NOT_ENOUGH。研究状态将该结果记录为 failed，保留原原因供续问和同参重试使用，不混同于缺失归档的未核验结果。有效 stale-cache 仍按原策略明确展示。

`show_dashboard` 不抓取行情数据，仅读取 `.ohquant/benchmark/results/*.json`。

## 3. 工具规格

### `compute_factor`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `symbol` | 是 | - | 行情 symbol。 |
| `factor` | 是 | - | 可选值：`momentum`、`reversal`、`volatility`、`volume_ratio`、`rsi`、`sma_deviation`。 |
| `period` | 否 | `20` | 回看窗口。 |
| `start` / `end` | 当前模式否；历史模式是 | 自动回看窗口 | 抓取、计算及核验共用的日期边界；需包含至少 period + 1 个有效观察。 |
| `market` / `source` / `observed_before` | 当前模式可传匹配代码的 `market`，不传 `source`/截止；历史模式须给 market 和截止 | - | 当前 `market` 只校验身份，数据源仍取配置；历史 `source` 可选，截止必须是精确 UTC 时刻，只读同一旧响应。 |

输出文本：

- symbol 和因子窗口
- 实际数据源、缓存状态和数据日期
- 最新因子值
- 历史均值
- 百分位排名

Details 对象包含 `symbol`、`factor`、`period`、`last`、`mean` 和 `percentile`。

### `run_backtest`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `symbol` | 是 | - | 行情 symbol。 |
| `fast` | 否 | `20` | 快线 SMA 窗口。 |
| `slow` | 否 | `60` | 慢线 SMA 窗口。 |
| `cash` | 否 | `100000` | 初始资金。 |
| `commission` | 否 | `0.0003` | 双向模拟佣金率，非真实券商费率。 |
| `stamp_duty` | 否 | `0` | 卖出方向附加费率，由研究者显式指定。 |
| `start` | 当前模式否；历史模式是 | - | 实际参与抓取和计算的日期边界。 |
| `end` | 当前模式否；历史模式是 | - | 实际参与抓取和计算的日期边界。 |
| `market` / `source` / `observed_before` | 当前模式可传匹配代码的 `market`，不传 `source`/截止；历史模式须给 market 和截止 | - | 当前 `market` 只校验身份，数据源仍取配置；历史 `source` 可选，截止必须是精确 UTC 时刻，只读同一旧响应。 |

前置条件：自动获取的有效数据至少包含 `slow + 10` 行。

输出文本：

- 总收益率
- CAGR
- Sharpe
- 最大回撤
- 上涨期间比例（非交易胜率）
- 平均盈利期间 / 平均亏损期间的收益绝对值之比

Details 包含 `symbol`、报告指标、`dates`、`ledger`（cash/position/trade/cost/equity/returns）和 `assumptions`。前一根信号在下一根收盘成交，允许碎股，无滑点；费用从现金支付，不默认借款。CAGR 按实际日历跨度 / 365.25 复利年化；波动率和 Sharpe 按注明的 252 期间频率。Sharpe 默认年化无风险率 2%，Sortino 默认目标收益 0；下行偏差使用全部期间。无可定义分母时比率为 null，文本展示 N/A。首行现金快照不计入收益期间。独立数值验收见 [R01](./feature-delivery.md)。

### `check_risk`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `symbol` | 是 | - | 行情 symbol。 |
| `start` | 当前模式否；历史模式是 | - | 实际参与抓取和计算的日期边界。 |
| `end` | 当前模式否；历史模式是 | - | 实际参与抓取和计算的日期边界。 |
| `market` / `source` / `observed_before` | 当前模式可传匹配代码的 `market`，不传 `source`/截止；历史模式须给 market 和截止 | - | 当前 `market` 只校验身份，数据源仍取配置；历史 `source` 可选，截止必须是精确 UTC 时刻，只读同一旧响应。 |

输出文本：

- 年化波动率
- 下行波动率
- 历史 VaR 和参数 VaR 95
- VaR 99
- CVaR 95
- 最大回撤深度与最长处于回撤中的观察期数分别显示；后者不是最大回撤峰谷段的持续时间，也未校验交易所日历完整性
- 偏度和峰度

Details 对象包含 `symbol` 和所有风险指标。

2026-10-11 补充：工具文本和归档报告共用 [风险口径说明](../src/quant/risk.ts)。波动率和零目标下行偏差按 252 期年化；历史 VaR 是样本低收益分位，CVaR 是该分位及以下收益的均值，两者保留逐期收益符号、不年化，也不表示未来损失上限。最长回撤持续期按连续低于前峰的观察期数计算，不是日历天数或最深回撤的峰谷跨度。模型回答的六项明确数字与当前验收调用绑定；识别范围和复跑方式见 [六指标风险评测](./research-task-evaluation.md#2026-10-11六指标风险回答与非零回撤评测)。

### `fund_dca_backtest`

用户直接提出定投研究，例如“按每月 1 日投入 1000，回测 270042.OF 在 2025 年的定投表现”。工具通过 `runtime/fund-data.ts` 实时获取 AKShare 单位 NAV，保存不可变公开输入引用，不读取账户持仓或历史 NAV 缓存。

| 字段 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `symbol` | 是 | - | 六位基金代码或 `.OF`；股票交易所后缀拒绝。 |
| `start_date` | 否 | 有效结束日前五年 | YYYY-MM-DD；闰日回推到目标月末。 |
| `end_date` | 否 | 最新 NAV 日期 | 上限为最新观察日期，不在此日期之后申购。 |
| `frequency` | 否 | `monthly` | weekly / biweekly / monthly / quarterly。 |
| `invest_amount` | 否 | `1000` | 每期固定总投入，含申购费，有限且大于 0。 |
| `invest_day` | 否 | `1` | 周频 1–7（周一为 1）；月/季频 1–31，短月按月末。 |
| `purchase_fee_rate` | 否 | 当前公开费率或零费假设 | 显式指定时不请求当前费率；`0` 是明确的零费假设。 |
| `purchase_fee_unit` | 否 | 显式值保留既有自动解释 | 推荐明确 decimal / percent，例如 `0.0013` decimal 与 `0.13` percent 均为 0.13%。 |

未指定 fee unit 时，显式 rate 大于 `0.05` 按百分数，否则按小数；该既有解释会使 `0.03` 被视为 3%，研究调用应显式给单位。AKShare `fund_purchase_em` 字段始终按百分数转换，`0.03` 为 0.03%。`feeBasis` 区分 `explicit-assumption`、`current-published-assumption`、`unavailable-assumed-zero`，当前费率并非历史费率证据。

计划在约定日之后的首个可用 NAV 申购，允许碎份额；净投入 = 总投入 / (1 + 费率)。起点早于首个 NAV 超过 31 天时裁到首日，31 天内保留计划日以支持顺延；终点裁到最新观察。日期必须有效，区间无数据/无计划交易明确报错。只有上游完全空 NAV 时返回 `NAV Rows 0`，不生成伪摘要或复用旧归档。

`methodVersion: 2` 结果含 `dataset`、`feeBasis`、`navCurve`、`latestNav`、`dcaPlan`、`dcaTrades`、`dcaAccountCurve` 和 `dcaSummary`。本金收益率是利润/累计投入；TWR 先估值旧份额再剔除新投入，申购费计入收益，最大回撤基于 TWR 而非累计市值。申购前基准为 1，首个观察点已扣首笔费用。XIRR 用实际天数/365，对日期现金流求 NPV 为零的年率；无可求解结果为 null，不能用本金收益率代替。

解释说明由已计算账本生成：给出首末笔实际申购日、申购 NAV、期末持有天数与净投入/总份额形成的混合平均单位成本；平均成本不是每笔申购 NAV。收益解释明确本金收益随 NAV 路径、份额、投入日期和费用变化，`.OF` 与 A 市场取数路由不证明基金底层资产类别或 A 股持仓。跨基金/基准 TWR 比较需对齐估值期间、收益类型、币种，以及费用和分红处理；本工具只有单位 NAV，不能直接与未对齐的总收益基准比较，也不构成符合 [GIPS 业绩标准](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/) 的报告。

输入只含单位 NAV，未处理现金分红、拆分、赎回费用或历史申购限额，不能称为完整基金总回报或真实账户业绩。参数、NAV/费率引用及全账本核对通过后才进入报告的 Verified research results 和无金额分享；旧方法报告保持原字节。专项与独立公式证据见 [R02 第六阶段](./feature-delivery.md#r02-第六阶段基金-nav-与定投研究)。

### `score_benchmark`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `symbol` | 是 | - | 策略 symbol。 |
| `benchmark_symbol` | 否 | `000300.SH` | Benchmark symbol。 |
| `fast` | 否 | `20` | 快线 SMA 窗口。 |
| `slow` | 否 | `60` | 慢线 SMA 窗口。 |
| `cash` | 否 | `100000` | 初始资金。 |
| `label` | 否 | `sma_<fast>_<slow>` | 制品策略标签。 |

行为：

1. 推断策略和 benchmark symbol 的市场。
2. 为两个 symbol 抓取本地数据。
3. 按日期对齐数据。
4. 运行 SMA 策略。
5. 将数据拆分为训练/测试窗口用于稳健性评分。
6. 按 100 分制对收益、风险和稳健性进行评分。
7. 保存 JSON 至 `.ohquant/benchmark/results/`，文件名包含唯一 ID，多次评分不会互相覆盖。

输出文本包含评级、总分、各维度得分、CAGR、Sharpe、最大回撤和已保存的文件名。

Details 对象包含 `filename` 和 benchmark score 对象。

评分工具同样接受 `commission` / `stamp_duty`（默认 0.0003 / 0）。保存的 `methodVersion: 3` 结果包含共同日期、费用、年化与成交假设，并保存完整 `parameters`（fast/slow/cash/commission/stampDuty）供独立 Dashboard 研究重算；评分算法沿用第二版。训练/测试分别重新从现金开始，Benchmark 为同日无费用买入持有基线。两条曲线各自使用 provider 收盘价，不做同币种换算；跨币种时“超额 CAGR”只是两个报价价格收益率之差，不是统一计价币种的投资者收益。此时若要比较统一币种收益，需使用带显式报价币种与同日 FX 的 `compare_portfolios`。新评分制品的 `priceBasis` 与研究重算口径冲突时不进入已核验报告；旧制品缺少该字段时从原计算路径重推，不把缺失字段当作已换汇证据。月度胜率按观测到的日历月份聚合（含首末不完整月），不是滚动 21 天块。未定义 Sharpe/Calmar 不贡献相应评分，Dashboard 的 Sharpe 排名将 N/A 放在末尾。

### `show_dashboard`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `sort_by` | 否 | - | 按 `score`（默认）、`cagr` 或 `sharpe` 降序排名。 |

行为：

1. 按文件名排序，捕获 `.ohquant/benchmark/results/*.json` 的一次读取集合。每条包含文件名、解析后 JSON 的 SHA-256 和原结果；损坏文件保留并计数，每 32 个文件让出事件循环以响应取消。
2. 非空策略名且总分为有限的 0–100 才是有效记录；缺失 CAGR/Sharpe/回撤为 null，不当作 0。
3. 汇总全部有效记录，偶数样本中位数取中间两值平均；Sharpe/回撤平均值只计有值样本。
4. 按所选键降序展示前 10 行，缺失值最后，同值保留捕获顺序。不同标的/区间的历史评分排名不等于统一窗口的组合比较；报价价格未经汇率换算，跨币种排序也不代表统一计价币种的投资者收益排序。

如无制品存在，工具返回自然语言提示，建议用户先运行 benchmark 分析。

Details 使用 `methodVersion: 1`，含 `sortBy`、`snapshots`、`unavailableFiles`、`invalidResults`、`rows`、`summary`。文件系统没有全目录事务：集合是这次扫描实际读到的文件版本，捕获后随工具结果进入 session/报告，不另建会漂移的 catalog。后续报告不重新读取当前评分目录。

报告核对集合中全部有效评分的参数、数据引用、费用、指标，再核对完整汇总与排名。有旧版缺参数评分时仍可本地浏览，但整份汇总计为未支持；输入丢失或结果被改写计为未核验，不用部分记录冒充完整排名。分享仅展示核对通过的公开标的/区间/费率假设、分数和比率，不包含策略私密标签、文件名、现金或原评分对象。详见 [第七阶段验收](./feature-delivery.md#r02-第七阶段排行榜结果绑定与数据测量)。

## 4. 存储影响

组合工具完整参数、币种/权重/缺失规则、计算公式与测试见 [观察组合比较](./portfolio-comparison.md)。它们使用独立纯计算、runtime 编排和版本化制品，不调用未注册的旧 compare handler。

| 工具 | 读取 | 写入 |
|------|-------|--------|
| `compute_factor` | 新鲜缓存或 provider | 成功抓取后更新行情缓存 |
| `run_backtest` | 新鲜缓存或 provider | 成功抓取后更新行情缓存 |
| `check_risk` | 新鲜缓存或 provider | 成功抓取后更新行情缓存 |
| `fund_dca_backtest` | 实时 AKShare NAV / 可选公开申购费 | 公开 NAV/费率不可变归档，不保存模拟金额到该目录 |
| `score_benchmark` | 新鲜缓存或 provider | 行情缓存和 `.ohquant/benchmark/results/*.json` |
| `show_dashboard` | `.ohquant/benchmark/results/*.json` | 无 |
| `list_portfolios` / `edit_portfolio` | 观察组合配置与 revision | 仅 edit 按期望版本修改观察组，返回 before/after |
| `compare_portfolios` | 观察组、公开价格/NAV 与 FX | 市场数据归档和不可变比较制品；不修改观察组 |
| `portfolio_comparisons` | `.ohquant/benchmark/comparisons/portfolios/*.json` | 无；加载从记录输入重算 |

所有本地文件系统活动应发出 storage file event，以便 Conversation tool-call stream 统一展示 READ/WRITE/MKDIR 活动。

## 5. Agent 使用规则

- 不要将这些工具暴露为 slash 命令。
- 量化工作优先使用自然语言。
- 直接调用分析工具；数据获取由工具负责。用户单独请求原始行情时使用 `fetch_bars`。
- 当用户要求策略评分、排名、评级或 benchmark 对比时使用 `score_benchmark`。
- 当用户要求查看已保存的 benchmark 结果或策略排行榜时使用 `show_dashboard`。
- 个人投资组合持仓不得存入 `.ohquant/portfolio/`；portfolio 存储规则与量化工具制品分离。
