# 内置工具注册表

> 最后更新：2026-09-15

WhyJ Quant 使用小型静态注册表管理内置 agent 工具。目标是在不将工具绑定分散到 agent facade、CLI helper 和 TUI 显示代码的前提下，使未来添加工具更加容易。

## 设计

`src/tools/registry.ts` 是内置工具发现与会话工具组装入口。`BUILTIN_TOOLS` 是 108 个无会话绑定的静态工具；`bindResearchTools()` 接收当前会话的只读分支端口，追加 `research_task`，完整 Quant Runtime 默认共 109 个工具。低层 createAgent 与自定义宿主仍消费显式注入集合。

它负责：

- agent 的启用工具顺序
- 工具领域元数据：`data`、`quant` 或 `system`
- 对话显示标签元数据
- 按工具名进行 CLI 查找
- 重复名称检查
- 缺失实现检查
- 必填能力要求：市场、provider 路由、凭证、Python 依赖、端点权限及副作用

它有意不实现动态插件加载器。内置工具随仓库发布，与应用一起类型检查，并以静态方式 import。

`createBuiltinTools({ analysisData })` 可为单个宿主注入价格读取端口，仅替换因子、回测和风险工具的读取依赖，schema 与纯计算保持原实现。静态注册表及其他实例不变；默认端口仍为 `loadAnalysisBars`。真实模型的合成数据评测使用此入口，见 [研究任务评测](./research-task-evaluation.md)。

## 运行时流程

```text
工具实现
  -> src/tools/registry.ts
    -> BUILTIN_TOOLS
      -> src/agent/src/session.ts AgentHarness tools
    -> findBuiltinTool()
      -> 内部工具查找
    -> builtinToolDisplay()
      -> src/tools/catalog.ts TUI 转录标签
    -> listBuiltinToolCapabilities()
      -> Doctor / Tool capabilities / 端点检查
```

这保持四个层面的一致性：

| 层面 | 注册表 API | 用途 |
|---------|--------------|---------|
| Agent loop | `BUILTIN_TOOLS` / `bindResearchTools()` | 默认静态集合及按会话绑定的研究工具；最终活动集合由 Session 消费。 |
| 工具查找 | `findBuiltinTool(name)` | 内部按名称解析；不新增 `/skill trigger` 命令。 |
| TUI 标签 | `builtinToolDisplay(name)` | 稳定的转录标签，如 `Quant.Risk`。 |
| 诊断/测试 | `listBuiltinToolRegistrations(domain?)` | 检查组和启用顺序。 |
| 能力发现 | `listBuiltinToolCapabilities()` | 从实际工具投影名称、描述、schema、显示名、领域与 requirements，不导出 execute。 |

## 能力与端点检查

当前注册 108 个工具（89 data、18 quant、1 system）。`runtime/tool-readiness.ts` 是只读状态投影：`blocked` 表示缺少已知前提，`unverified` 表示尚未检查，`sample-verified` 只证明所测输入样本，`local` 表示不依赖行情 provider、尚未执行。Tools 阶段会检查所有已注册 AKShare 路由的 Python/package 依赖，即使首选源是 Financial Datasets。

`fetch_bars_archive` 的 `observed_before` 为必填 UTC 时刻，只读取应用在此之前观察并保存的完整不可变响应版本；它不准备 provider 凭证、调用 Python 或读取当前缓存 head。显式选择来源时，损坏的行情设置也不会阻断这条本地读取路径。归档不存在或损坏由执行回执报告，Doctor 的 `local` 只表示读取路径可以运行。普通 `fetch_bars` 仍声明行情路由；其可选同名截止参数复用归档执行契约，但离线发现应使用专门的归档工具。

`analyze_archived_bars` 也是独立 `local` 能力：必填市场、价格起止日、UTC 观察截止和 `factor | backtest | risk` 模式，因子模式还需 `factor`；一个旧响应必须完整覆盖窗口并提供足够有效行。工具调用现有因子/回测/风险计算而不复制公式，回执保存原 DatasetRef、观察时刻和明确的归档截止。报告和会话恢复重新检查修订与截止、独立重算指标；任务验收必须声明同一截止和模式。`local` 不证明归档存在、真实 provider 发布时间或交易日完整，详见 [归档研究](./data-validation.md#2026-09-15归档时点研究计算)。

`compute_factor`、`run_backtest`、`check_risk` 的可执行 schema 现在也接受 `observed_before`；传入时必须同时有 `market`、`start`、`end`，可选 `source`。这一路径只读旧归档，输入不匹配、缺损或缺少足够行显式失败，报告和研究任务按原调用中的截止重审。默认调用仍走自动行情路由，因此 Doctor 对这三个工具显示的是当前行情依赖；要单独发现 provider-free 入口，使用 `analyze_archived_bars`。能力声明包含两种模式可能的效果，不表示一次归档调用会请求网络。

`annual_report/annual_reports` 从选定的组合比较及公开数据归档生成、列出和恢复离线年报；声明本地读取和研究制品写入，无网络或账户端口。年度区间、缺项与观点出处见 [年度研究报告](./annual-reports.md)。Doctor 的 local 不代表原始档案一定存在，执行时必须重新核对。

`research_decisions` 为年报提供显式研究选择日志，read/list/record 共用原始比较与数据核验；请求标识幂等，理由和声明日期不升级为已核验用户批准或成交。年报仅消费明确传入的 decision_ids；日志与年报共用 annual-research 能力声明。

`research_news` 组合新闻与价格两个独立依赖，默认新闻端点为 Yahoo 搜索和 A 股 AKShare 东方财富；US/HK 的价格路由现在也包括零凭证 AKShare 新浪日线。可分别探测新闻与日线，不能用其中一项证明全部就绪；未查 Python/端点时标为 `unverified`，已知缺 Python 且无其他价格凭证时才标为 `blocked`。`createBuiltinTools({ news })` 可注入传输/价格/归档读取端口，复用原 schema 与实现。标题情绪置信边界、恢复及测试见 [新闻研究](./news-research.md)。

进入 `research_news` Endpoint check 时，默认选择新闻路由；即使当前行情源设为 AKShare，US/HK 也先展示 Yahoo 新闻检查。独立价格 `daily-series` 仍保留在可选端点列表，可手动验证，不会把日线样本误作新闻响应。

新增 `alpha_backtest/alpha_runs/alpha_engine_status` 来自 [Alpha 工具](../src/tools/alpha-tools.ts)。前者额外要求用户配置的 AKQuant Python 环境，取数前检查版本并绑定固定数据/研究档案；后两者提供原始回执复核和单独依赖检查。价格端点检查不能证明引擎可用。`createBuiltinTools({ alpha })` 可注入运行/历史/依赖端口，保留原 schema 与默认注册关系，契约见 [Alpha](./alpha-backtest.md)。

另一个会话绑定工具 `research_task` 的 schema/执行/引导来自 [research-task-tool.ts](../src/tools/research-task-tool.ts)，标签使用共享 display 映射。它需要当前 Quant Session 分支，read/declare/resolve/cancel 不调用 provider；不在无会话的 Doctor 端点目录中伪造为可探测行情能力。重复名称在绑定时失败，每个实例有独立读口，不使用全局 currentAgent。其工具说明仅在当前活动集合包含该工具时注入；按任务筛选其余工具的 schema 和 skills 依赖仍由 F24 继续实现。

任务 read 返回可直接复制的 expectedRevision 字符串和 requestEntryId，以及当前可用价格工具的 metricLabels。首次声明的令牌绑定当前用户 entry，已有任务使用已提交事件 ID；错误/省略令牌继续拒绝，journal 内部的 null 前置条件由宿主处理。指标名称来自归档核验所用的同一份常量。此发现接口不等于已完成所有 Quant 工具或 skills 的指标目录。

Data connection 的 `Tool capabilities` 和 Doctor 中的 `v` 打开工具列表；输入名称搜索，Enter 看详情，`p` 打开 Endpoint check。所选路由使用 `runtime/tool-probe.ts`，通过 CLI/TUI 共用服务调用实际 source adapter。AKShare 基金端点复用工具定义中的参数 schema，排除只作用于工具输出的 fund_code/keyword/limit；指数通用端点沿用现有白名单与 API kwargs 契约。

每次只检查一个所选路由/端点和参数，不执行量化计算、shell，也不写缓存、报告或设置。`daily-series` 是日线适配器路径，实际窗口仍经过行情校验；具名端点的 `scope: endpoint-response` 仅证明该请求返回非空数据行，不证明字段语义、实时性、全部参数或财务事实。目录类端点可能返回完整列表，不把本地行数限制当上游分页。取消和超时不会接受晚到结果。

关键路由：`search_symbols` 只使用 Tushare `stock_basic`，仅支持 A 股；日线权限不能证明搜索权限。`fetch_index_spot` 先 Sina HTTP，再 AKShare，缺 Python 只阻断后一路；检查时可分别选择它们。基金工具固定使用 AKShare，不随首选日线 provider 改变。

组合比较声明的是复合输入：股票日线源是可替代路由，基金用 NAV，外币另需 Frankfurter/ECB 汇率。Endpoint check 可独立检查 `ecb-fx`，参数为 base/quote/start/end；同币种检查拒绝，以免恒等计算伪装成网络验证。一个价格或汇率响应不能证明整份比较可用。观察组修改另声明 `portfolio-preferences` 副作用，比较本身没有该副作用。

端点检查结果留在当前检查编辑器，关闭后不保存成长期权限。参数/连接改变使证据失效；成功也不会把整份工具清单标为 ready。复跑命令与返回约定见 [Slash 参考](./slash-commands.md)。按研究任务装配工具、skills 融合与效果评测仍属于 F24；此注册表仍不是 extension host。

## 添加未来的内置工具

1. 将工具实现为 `AgentTool`。
2. 从对应的领域模块导出，例如 `DATA_TOOLS`、`COMPUTE_TOOLS` 或 `SYSTEM_TOOLS`。
3. 在 `src/tools/registry.ts` 中添加一条注册：

```ts
{
  tool: mustTool(COMPUTE_TOOLS, "new_tool_name"),
  domain: "quant",
  display: { label: "Quant.NewTool" },
  requirements: dailyRequirements(true), // 按实际输入、端点和副作用声明
}
```

4. 添加或更新 `src/tools/registry.test.ts` 中的测试。
5. 如果工具有非显而易见的行为，在领域文档（如 `docs/quant-tools-design.md`）中记录契约。

工具随即通过同一条注册记录对 agent、CLI 查找和 TUI 显示代码可用。

## 规则

- 不要在 `registry.ts` 外部直接拼接工具数组。
- 不要在 `registry.ts` 外部维护独立的静态显示映射。
- 仅当现有 `data`、`quant` 和 `system` 分组不再能描述该工具时，才创建新的领域模块。
- 保持标签简短；Conversation 面板的宽度有限。
- 仅对需要注册但暂不向 agent 暴露的实验性工具使用 `enabledByDefault: false`。
